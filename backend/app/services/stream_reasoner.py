"""Streaming-friendly reasoning: stage hooks + optional agent for the answer pass."""

from __future__ import annotations

import os
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from functools import partial
from typing import Any

from app.models.schemas import VlmInferenceRequest
from app.services import reasoner as reas
from app.services.reasoner_agent import run_answer_with_agent


def _merge_usage_into_timings(
    base: dict[str, Any],
    *,
    spatial_usage: dict[str, int] | None,
    extra_rounds: list[dict[str, int]],
) -> None:
    rounds: list[dict[str, int]] = []
    if spatial_usage:
        rounds.append(spatial_usage)
    rounds.extend(extra_rounds)
    if not rounds:
        return
    base["usage_rounds"] = rounds
    base["usage_total"] = reas.sum_usage_rounds(rounds)

_StageCallback = Callable[[str, float, dict[str, Any] | None], None]
_ToolCallback = Callable[[str, dict[str, Any]], None]


def _spatial_keys() -> tuple[str, ...]:
    return (
        "layoutStyle",
        "detected_language",
        "detected_script",
        "script_direction",
        "intent_hint",
        "preferred_side",
        "placement_mode",
        "target_column_index",
        "spatial_confidence",
    )


def run_streaming_reasoning(
    request: VlmInferenceRequest,
    *,
    on_stage: _StageCallback | None = None,
    on_tool: _ToolCallback | None = None,
) -> dict[str, Any]:
    t0 = time.perf_counter()
    stage_log: list[dict[str, Any]] = []
    out_mode = "answer"
    tool_trace: list[dict[str, Any]] = []

    def st(name: str, detail: dict[str, Any] | None = None) -> None:
        row: dict[str, Any] = {
            "name": name,
            "t_ms": (time.perf_counter() - t0) * 1000.0,
            "detail": detail,
        }
        stage_log.append(row)
        if on_stage:
            on_stage(name, float(row["t_ms"]), detail)

    st("reading_canvas", None)
    provider = reas._provider()  # type: ignore[attr-defined]
    use_agent = (os.getenv("REASONER_STREAM_AGENT", "1") or "1") == "1"

    def on_tool_both(phase: str, info: dict[str, Any]) -> None:
        st(f"tool_{phase}", info)
        if on_tool:
            on_tool(phase, info)

    if provider == "mock":
        out, timings = reas.generate_reasoning_text(request)
        st("finalizing", {"provider": "mock"})
        td: dict[str, Any] = {
            "provider": timings.get("provider", "mock"),
            "inference_ms": timings.get("inference_ms", 0.0),
            "parse_ms": timings.get("parse_ms", 0.0),
            "spatial_raw": timings.get("spatial_raw"),
            "spatial_pass_ran": timings.get("spatial_pass_ran", False),
            "spatial_parsed": timings.get("spatial_parsed"),
            "usage_rounds": timings.get("usage_rounds"),
            "usage_total": timings.get("usage_total"),
        }
        return {
            "output": out,
            "tool_trace": [],
            "stages": stage_log,
            "mode": "answer",
            "timings": td,
        }

    if (not use_agent) or provider != "openai":
        st("spatial_pass", None)
        st("answer_pass", None)
        out, timings = reas.generate_reasoning_text(request)
        st("parsing", None)
        st("finalizing", None)
        td2: dict[str, Any] = {
            "provider": timings.get("provider", "openai"),
            "inference_ms": timings.get("inference_ms", 0.0),
            "parse_ms": timings.get("parse_ms", 0.0),
            "spatial_raw": timings.get("spatial_raw"),
            "spatial_pass_ran": timings.get("spatial_pass_ran", False),
            "spatial_parsed": timings.get("spatial_parsed"),
            "usage_rounds": timings.get("usage_rounds"),
            "usage_total": timings.get("usage_total"),
        }
        return {
            "output": out,
            "tool_trace": [],
            "stages": stage_log,
            "mode": "answer",
            "timings": td2,
        }

    st("spatial_pass", None)
    st("answer_pass", None)
    inf_start = time.perf_counter()
    out: dict[str, Any] = {}
    spatial_ran = False
    spatial_raw: str | None = None
    spatial_parsed: dict[str, Any] = {}
    spatial_usage: dict[str, int] | None = None
    agent_usage_rounds: list[dict[str, int]] = []
    if request.spatialContextImageBase64:
        fn_agent = partial(run_answer_with_agent, on_tool=on_tool_both)
        with ThreadPoolExecutor(max_workers=2) as ex:
            af = ex.submit(fn_agent, request)
            sf = ex.submit(
                lambda: reas._openai_reasoning_text(  # type: ignore[attr-defined]
                    request,
                    query_text_override=reas._build_spatial_only_query_text(  # type: ignore
                        request
                    ),
                    image_base64_override=request.spatialContextImageBase64,
                )
            )
            ap, tool_trace, agent_usage_rounds = af.result()
            spatial_raw, spatial_usage = sf.result()
            spatial_raw = (spatial_raw or "").strip()
        out = dict(ap)
        if tool_trace:
            out_mode = "coding"
        if spatial_raw:
            spatial_ran = True
            so = reas._parse_dual_response(spatial_raw)  # type: ignore[attr-defined]
            reas.merge_spatial_layout_into_output(out, so)
            for k in _spatial_keys():
                spatial_parsed[k] = so.get(k)
    else:
        ap, tool_trace, agent_usage_rounds = run_answer_with_agent(
            request,
            on_tool=on_tool_both,  # type: ignore[call-arg]
        )
        out = dict(ap)
        if tool_trace:
            out_mode = "coding"

    parse_start = time.perf_counter()
    st("parsing", None)
    parse_ms = (time.perf_counter() - parse_start) * 1000.0
    st("finalizing", None)
    inference_ms = (time.perf_counter() - inf_start) * 1000.0
    timings_out: dict[str, Any] = {
        "provider": "openai",
        "inference_ms": round(inference_ms, 3),
        "parse_ms": round(parse_ms, 3),
        "spatial_raw": spatial_raw,
        "spatial_pass_ran": spatial_ran,
        "spatial_parsed": spatial_parsed or None,
    }
    _merge_usage_into_timings(
        timings_out,
        spatial_usage=spatial_usage,
        extra_rounds=agent_usage_rounds,
    )
    return {
        "output": out,
        "tool_trace": tool_trace,
        "stages": stage_log,
        "mode": out_mode,
        "timings": timings_out,
    }

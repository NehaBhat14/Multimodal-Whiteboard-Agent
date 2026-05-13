"""API routes for reasoning orchestration."""

import json
import time
from datetime import datetime, timezone
from pathlib import Path
from collections.abc import Iterator
from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import StreamingResponse

from app.models.schemas import (
    ResponseStageItem,
    ReasoningTimings,
    SpatialDebugInfo,
    TokenUsage,
    ToolTraceItem,
    VlmInferenceRequest,
    VlmInferenceResponse,
)
from app.services.reasoner import ReasoningProviderError, generate_reasoning_text
from app.services.stream_reasoner import run_streaming_reasoning

router = APIRouter(prefix="/api/v1", tags=["reasoning"])

# parents[2] resolves to the `backend/` directory.
_LOG_DIR = Path(__file__).resolve().parents[2] / "logs"
_REASON_RUNS_LOG = _LOG_DIR / "reason_runs.jsonl"


def _usage_from_timings_dict(tim: dict[str, Any]) -> tuple[
    TokenUsage | None,
    list[TokenUsage] | None,
    TokenUsage | None,
]:
    """Build response usage fields from generate_reasoning / stream timings dict."""
    raw_rounds = tim.get("usage_rounds")
    raw_total = tim.get("usage_total")
    rounds_m: list[TokenUsage] | None = None
    if isinstance(raw_rounds, list) and raw_rounds:
        rounds_m = []
        for item in raw_rounds:
            if isinstance(item, dict):
                rounds_m.append(
                    TokenUsage(
                        prompt_tokens=item.get("prompt_tokens"),
                        completion_tokens=item.get("completion_tokens"),
                        total_tokens=item.get("total_tokens"),
                    )
                )
    total_m: TokenUsage | None = None
    if isinstance(raw_total, dict):
        total_m = TokenUsage(
            prompt_tokens=raw_total.get("prompt_tokens"),
            completion_tokens=raw_total.get("completion_tokens"),
            total_tokens=raw_total.get("total_tokens"),
        )
    usage_alias = total_m
    return usage_alias, rounds_m, total_m


@router.post("/reason", response_model=VlmInferenceResponse)
def post_reason(request: VlmInferenceRequest) -> VlmInferenceResponse:
    """Run reasoning and return the response with lifecycle + stage timings."""
    started_at = datetime.now(timezone.utc).isoformat()
    total_start = time.perf_counter()

    try:
        reasoning_output, stage_timings = generate_reasoning_text(request)
    except ReasoningProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    total_ms = (time.perf_counter() - total_start) * 1000.0
    finished_at = datetime.now(timezone.utc).isoformat()

    timings = ReasoningTimings(
        provider=stage_timings["provider"],
        inference_ms=stage_timings["inference_ms"],
        parse_ms=stage_timings["parse_ms"],
        total_ms=round(total_ms, 3),
    )

    debug_spatial: SpatialDebugInfo | None = None
    if "spatial_pass_ran" in stage_timings:
        debug_spatial = SpatialDebugInfo(
            pass_ran=bool(stage_timings.get("spatial_pass_ran")),
            raw_output=stage_timings.get("spatial_raw"),
            parsed=stage_timings.get("spatial_parsed"),
        )

    usage, usage_rounds, usage_total = _usage_from_timings_dict(stage_timings)

    return VlmInferenceResponse(
        my_response=reasoning_output["my_response"],
        what_i_see=reasoning_output["what_i_see"],
        spatial=request.spatial,
        status="COMPLETED",
        started_at=started_at,
        finished_at=finished_at,
        timings=timings,
        layoutStyle=reasoning_output.get("layoutStyle"),
        detected_language=reasoning_output.get("detected_language"),
        detected_script=reasoning_output.get("detected_script"),
        script_direction=reasoning_output.get("script_direction"),
        intent_hint=reasoning_output.get("intent_hint"),
        preferred_side=reasoning_output.get("preferred_side"),
        placement_mode=reasoning_output.get("placement_mode"),
        target_column_index=reasoning_output.get("target_column_index"),
        spatial_confidence=reasoning_output.get("spatial_confidence"),
        debug_spatial=debug_spatial,
        canvasActions=reasoning_output.get("canvasActions"),
        usage=usage,
        usage_rounds=usage_rounds,
        usage_total=usage_total,
    )


def _sse(data: dict[str, Any]) -> bytes:
    return (
        f"data: {json.dumps(data, default=str, separators=(',', ':'))}\n\n".encode("utf-8")
    )


def _response_from_stream_payload(
    request: VlmInferenceRequest,
    payload: dict[str, Any],
    started_at: str,
    finished_at: str,
) -> VlmInferenceResponse:
    out = payload["output"]
    tim = payload.get("timings", {})
    tinf = float(tim.get("inference_ms", 0) or 0) + float(tim.get("parse_ms", 0) or 0)
    timings = ReasoningTimings(
        provider=str(tim.get("provider", "openai")),
        inference_ms=float(tim.get("inference_ms", 0) or 0),
        parse_ms=float(tim.get("parse_ms", 0) or 0),
        total_ms=round(tinf, 3),
    )
    debug_spatial: SpatialDebugInfo | None = None
    if tim.get("spatial_pass_ran"):
        debug_spatial = SpatialDebugInfo(
            pass_ran=bool(tim.get("spatial_pass_ran")),
            raw_output=tim.get("spatial_raw"),
            parsed=tim.get("spatial_parsed"),
        )
    usage, usage_rounds, usage_total = _usage_from_timings_dict(tim)
    tt: list[ToolTraceItem] | None = None
    raw_t = payload.get("tool_trace") or []
    if raw_t:
        tt = [
            ToolTraceItem(
                name=str(x.get("name", "")),
                args=str(x.get("args", ""))[:2000],
                ms=float(x.get("ms", 0) or 0),
                ok=bool(x.get("ok", True)),
                bytes=int(x.get("bytes", 0) or 0),
            )
            for x in raw_t
            if isinstance(x, dict)
        ]
    st: list[ResponseStageItem] | None = None
    raw_s = payload.get("stages") or []
    if raw_s:
        st = [
            ResponseStageItem(
                name=str(x.get("name", "")),
                t_ms=float(x.get("t_ms", 0) or 0),
                detail=x.get("detail") if isinstance(x.get("detail"), dict) else None,
            )
            for x in raw_s
            if isinstance(x, dict)
        ]
    return VlmInferenceResponse(
        my_response=str(out.get("my_response", "")),
        what_i_see=str(out.get("what_i_see", "")),
        spatial=request.spatial,
        status="COMPLETED",
        started_at=started_at,
        finished_at=finished_at,
        timings=timings,
        tool_trace=tt,
        stages=st,
        mode=payload.get("mode") if payload.get("mode") in ("answer", "coding") else None,  # type: ignore
        layoutStyle=out.get("layoutStyle"),
        detected_language=out.get("detected_language"),
        detected_script=out.get("detected_script"),
        script_direction=out.get("script_direction"),
        intent_hint=out.get("intent_hint"),
        preferred_side=out.get("preferred_side"),
        placement_mode=out.get("placement_mode"),
        target_column_index=out.get("target_column_index"),
        spatial_confidence=out.get("spatial_confidence"),
        debug_spatial=debug_spatial,
        canvasActions=out.get("canvasActions")
        if isinstance(out.get("canvasActions"), list)
        else None,
        usage=usage,
        usage_rounds=usage_rounds,
        usage_total=usage_total,
    )


@router.post("/reason/stream")
def post_reason_stream(
    request: VlmInferenceRequest,
) -> StreamingResponse:
    """Stream ``stage`` events, then a ``final`` event with the full Vlm body."""

    def event_gen() -> Iterator[bytes]:
        started = datetime.now(timezone.utc).isoformat()
        try:
            payload = run_streaming_reasoning(request)
        except ReasoningProviderError as exc:
            yield _sse({"type": "error", "message": str(exc)[:2000]})
            return
        for row in payload.get("stages") or []:
            if isinstance(row, dict):
                yield _sse(
                    {
                        "type": "stage",
                        "name": row.get("name"),
                        "t_ms": row.get("t_ms"),
                        "detail": row.get("detail"),
                    }
                )
        for item in payload.get("tool_trace") or []:
            if isinstance(item, dict):
                yield _sse(
                    {
                        "type": "tool_result",
                        "name": item.get("name"),
                        "ms": item.get("ms"),
                        "ok": item.get("ok", True),
                        "bytes": item.get("bytes", 0),
                    }
                )
        finished = datetime.now(timezone.utc).isoformat()
        resp = _response_from_stream_payload(request, payload, started, finished)
        yield _sse(
            {
                "type": "final",
                "body": resp.model_dump(mode="json"),
            }
        )

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/metrics/reason_run", status_code=204)
async def log_reason_run(request: Request) -> Response:
    """Append the client-posted run record as a JSON line; body stored as-is."""
    try:
        body: Any = await request.json()
    except Exception:
        return Response(status_code=400)

    record = {
        "received_at": datetime.now(timezone.utc).isoformat(),
        "body": body,
    }

    try:
        _LOG_DIR.mkdir(parents=True, exist_ok=True)
        with _REASON_RUNS_LOG.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(record, separators=(",", ":")) + "\n")
    except OSError:
        return Response(status_code=500)

    return Response(status_code=204)

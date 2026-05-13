"""Answer pass: OpenAI chat.completions with tools, bounded tool rounds."""

from __future__ import annotations

import json
import os
import time
from collections.abc import Callable
from typing import Any, Literal, Optional
from urllib import error, request

from app.models.schemas import VlmInferenceRequest
from app.services import reasoner as reas
from app.services.tools import registry

_MAX_OUT = 4096
_URL = "https://api.openai.com/v1/chat/completions"
_MODEL = "gpt-4o"

# Heuristic for Reflexion-lite follow-up when the model hedges without web research.
_UNCERTAIN_NEEDLES: tuple[str, ...] = (
    "i don't know",
    "i do not know",
    "i'm not sure",
    "im not sure",
    "not sure who",
    "not sure what",
    "cannot verify",
    "can't verify",
    "unable to verify",
    "unclear who",
    "unclear what",
)


def _max_agent_tool_rounds() -> int:
    """Tool-capable API rounds before the final JSON-only round (ReAct-style)."""
    raw = (os.getenv("REASONER_AGENT_MAX_ROUNDS", "4") or "4").strip()
    try:
        n = int(raw)
    except ValueError:
        n = 4
    return max(1, min(n, 12))


def _max_uncertainty_nudges() -> int:
    """Reflexion-lite: extra full passes after a hedged answer (clamped 0–3, default 1)."""
    raw = (os.getenv("REASONER_AGENT_UNCERTAINTY_NUDGES", "1") or "1").strip()
    try:
        n = int(raw)
    except ValueError:
        n = 1
    return max(0, min(n, 3))


def _my_response_sounds_uncertain(text: str) -> bool:
    t = (text or "").strip().lower()
    if not t:
        return False
    return any(n in t for n in _UNCERTAIN_NEEDLES)


def _web_lookup_tools_enabled(allowed: frozenset[str] | None) -> bool:
    if allowed is None:
        return True
    return "web_search" in allowed or "fetch_url" in allowed


def _used_web_research(trace: list[dict[str, Any]]) -> bool:
    for row in trace:
        if not isinstance(row, dict):
            continue
        name = str(row.get("name", ""))
        if name in ("web_search", "fetch_url"):
            return True
    return False


def _data_url(b64: str) -> str:
    s = (b64 or "").strip()
    if not s:
        return ""
    return s if s.startswith("data:") else f"data:image/png;base64,{s}"


def _user_text(req: VlmInferenceRequest) -> str:
    base = (
        f"{reas.build_session_text_prefix(req)}"
        f"{(req.queryText or '').strip()}\n\n"
        f"[Spatial context — bounding box: {req.spatial.model_dump_json()}]\n"
    )
    suffix = reas.build_answer_prompt_suffixes(req, include_diagram_hint=True)
    if suffix:
        return f"{base}\n{suffix}\n"
    return base


def _tool_allowed(allowed: frozenset[str] | None, name: str) -> bool:
    return allowed is None or name in allowed


def _tools_rubric(allowed: frozenset[str] | None) -> str:
    """Tool-router lines: RAG tier local → sandbox → web (only enabled tools)."""
    reg = registry.build_registry()
    if allowed is not None and not allowed:
        return (
            "No external tools are enabled for this request — answer from the "
            "image and conversation only."
        )
    names = sorted(reg.keys() if allowed is None else allowed)
    if not names:
        return (
            "No external tools are enabled for this request — answer from the "
            "image and conversation only."
        )
    header = (
        "Tool router (ReAct): call tools only when needed; read JSON tool results; "
        "then call more tools or answer. RAG tier — prefer local retrieval, then "
        "sandbox files, then the public web; use model memory only when tools are "
        "irrelevant or disabled.\n"
        f"Enabled tool names (only these): {', '.join(names)}.\n"
    )
    lines: list[str] = []
    if _tool_allowed(allowed, "get_current_time"):
        lines.append(
            "- Relative dates ('today', 'yesterday') → get_current_time."
        )
    if _tool_allowed(allowed, "search_local_docs"):
        lines.append(
            "- Project PDFs / material under the data directory → search_local_docs first."
        )
    if _tool_allowed(allowed, "fetch_url"):
        lines.append(
            "- fetch_url: read a public http(s) page when you have a URL (e.g. from "
            "web_search or an explicit link). Do not invent page text if ok:false."
        )
    code_any = any(
        _tool_allowed(allowed, n) for n in ("list_dir", "grep_repo", "read_file")
    )
    if code_any:
        parts: list[str] = []
        if _tool_allowed(allowed, "list_dir"):
            parts.append("list_dir to navigate")
        if _tool_allowed(allowed, "grep_repo"):
            parts.append("grep_repo for regex search")
        if _tool_allowed(allowed, "read_file"):
            parts.append("read_file for a known path")
        lines.append(
            "- Code or config in the sandbox → " + "; ".join(parts) + "."
        )
    if _tool_allowed(allowed, "web_search") or _tool_allowed(allowed, "fetch_url"):
        lines.append(
            "- News, security incidents, product updates, or facts not on the board → "
            "web_search (and fetch_url for article detail when useful)."
        )
    lines.append(
        "- Purely describing what is drawn in the image with no external facts → "
        "no tools."
    )
    if _tool_allowed(allowed, "web_search"):
        lines.append(
            "- If web_search returns no useful hits (e.g. only a 'No results' row), "
            "retry once with a shorter, broader, or rephrased query before giving up."
        )
    return header + "\n".join(lines)


def _diagram_rubric(req: VlmInferenceRequest) -> str:
    """Gate canvasActions: only when diagram intent matches userMessage + queryText."""
    if reas.wants_diagram_canvas_actions(req):
        return (
            "Diagram intent: this turn asks for a diagram, flowchart, or visual "
            "structure. Emit a non-empty canvasActions array (create_geo nodes with "
            "create_arrow edges; optional create_text). Keep my_response to one short "
            "summary line. Follow the schema in queryText and any diagram hint in "
            "the user message."
        )
    return (
        "No diagram intent: omit canvasActions or use an empty array. Answer in "
        "my_response only; do not add shapes unless queryText explicitly requires "
        "non-diagram canvas edits."
    )


def _nudge_reviewer_text() -> str:
    return (
        "Your previous answer hedged (e.g. 'I don't know' / 'not sure'). Before "
        "finalizing, call web_search (and fetch_url if a result points to a readable "
        "article) to verify the specific entity or fact the user asked about, then "
        "respond again with a single JSON object only (same required keys as before)."
    )


def _post(body: dict[str, Any], timeout_s: float) -> dict[str, Any]:
    k = os.getenv("OPENAI_API_KEY", "").strip()
    if not k:
        raise reas.ReasoningProviderError("OPENAI_API_KEY is required for tool agent.")
    m = (os.getenv("OPENAI_MODEL", _MODEL) or _MODEL).strip()
    body = {**body, "model": body.get("model") or m}
    d = json.dumps(body).encode("utf-8")
    req = request.Request(  # noqa: S310
        _URL,
        data=d,
        headers={"Authorization": f"Bearer {k}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=timeout_s) as r:  # noqa: S310
            return json.loads(r.read().decode("utf-8"))
    except error.HTTPError as e:
        t = e.read().decode("utf-8", errors="replace")
        raise reas.ReasoningProviderError(
            f"OpenAI chat HTTP {e.code}: {t[:2000]}"
        ) from e
    except (error.URLError, OSError, TimeoutError, json.JSONDecodeError) as e:
        raise reas.ReasoningProviderError(f"OpenAI error: {e!s}") from e


def _run_answer_pass(
    *,
    messages: list[dict[str, Any]],
    tools_payload: list[dict[str, Any]],
    max_r: int,
    t_deadline: float,
    t_api: float,
    allowed: frozenset[str] | None,
    on_tool: Optional[Callable[[str, dict[str, Any]], None]],
    tool_trace: list[dict[str, Any]],
    usage_rounds: list[dict[str, int]],
) -> tuple[dict[str, Any], Optional[str], Literal["success", "timeout", "empty"]]:
    """One full ReAct pass through tool rounds + final JSON-only turn."""
    for rnd in range(max_r + 1):
        if time.perf_counter() > t_deadline:
            break
        is_last = rnd >= max_r
        body: dict[str, Any] = {
            "model": (os.getenv("OPENAI_MODEL", _MODEL) or _MODEL).strip(),
            "messages": messages,
        }
        if tools_payload:
            body["tools"] = tools_payload
            body["tool_choice"] = "none" if is_last else "auto"
        if is_last:
            body["response_format"] = {"type": "json_object"}
        data = _post(body, t_api)
        nu = reas.normalize_openai_usage(data.get("usage"))
        if nu:
            usage_rounds.append(nu)
        msg = (data.get("choices") or [{}])[0].get("message", {}) or {}
        tcs = msg.get("tool_calls")
        if tcs and not is_last:
            messages.append(
                {
                    "role": "assistant",
                    "content": msg.get("content"),
                    "tool_calls": tcs,
                }
            )
            for tc in tcs:
                if time.perf_counter() > t_deadline:
                    break
                if not isinstance(tc, dict):
                    continue
                fn = tc.get("function") or {}
                name = str((fn or {}).get("name", ""))
                args_s = str((fn or {}).get("arguments", "") or "")
                tcall_id = str((tc or {}).get("id", f"tc_{name}"))
                if on_tool:
                    on_tool("call", {"name": name, "round": rnd, "args_preview": args_s[:200]})
                t_ms: list[float] = []
                out = registry.run_tool(
                    name, args_s, t_deadline, t_ms, allowed=allowed
                )
                ms0 = t_ms[0] if t_ms else 0.0
                payload = json.dumps(out)[:_MAX_OUT]
                b = len(payload.encode("utf-8", errors="replace"))
                tool_ok = not (
                    isinstance(out, dict) and out.get("ok") is False
                )
                if on_tool:
                    on_tool(
                        "result",
                        {
                            "name": name,
                            "round": rnd,
                            "ms": round(ms0, 3),
                            "bytes": b,
                            "ok": 1 if tool_ok else 0,
                            "preview": payload[:200],
                        },
                    )
                tool_trace.append(
                    {
                        "name": name,
                        "args": args_s[:500],
                        "ms": round(ms0, 3),
                        "ok": tool_ok,
                        "bytes": b,
                    }
                )
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tcall_id[:200],
                        "name": name,
                        "content": payload,
                    }
                )
            continue
        raw = (msg.get("content") or "").strip()
        if raw:
            return reas._parse_dual_response(raw), raw, "success"
        if is_last:
            return (
                reas._parse_dual_response(  # type: ignore
                    '{"my_response": "", "what_i_see": "No content", "layoutStyle": "UNKNOWN", '
                    '"detected_language": "en", "detected_script": "Latin", "script_direction": "LTR"}'
                ),
                None,
                "empty",
            )
    parsed_timeout = reas._parse_dual_response(  # type: ignore
        (
            '{"my_response": "Could not finish in time", "what_i_see": "empty", "layoutStyle": "UNKNOWN", '  # noqa: E501
            '"detected_language": "en", "detected_script": "Latin", "script_direction": "LTR"}'
        )
    )
    return parsed_timeout, None, "timeout"


def run_answer_with_agent(
    request_payload: VlmInferenceRequest,
    *,
    on_tool: Optional[Callable[[str, dict[str, Any]], None]] = None,
) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, int]]]:
    """
    Returns (parsed output dict, tool_trace rows, usage per chat.completions call).
    on_tool is invoked with (phase, info) e.g. (
      "call" | "result", {"name", "round", "ms"?, "bytes"?, "ok"?, "preview"})
    """
    t_deadline = time.perf_counter() + float(
        os.getenv("REASONER_AGENT_BUDGET_S", "15.0")
    )
    t_api = float(os.getenv("OPENAI_TIMEOUT_SECONDS", "90"))
    tool_trace: list[dict[str, Any]] = []
    usage_rounds: list[dict[str, int]] = []
    u_content: list[dict[str, Any]] = [
        {"type": "text", "text": _user_text(request_payload)}
    ]
    durl = _data_url(request_payload.imageBase64)
    if durl:
        u_content.append({"type": "image_url", "image_url": {"url": durl}})
    now_utc = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    allowed = registry.allowed_tool_names_from_request(
        request_payload.enabledAgentTools
    )
    tools_rubric = _tools_rubric(allowed)
    diagram_rubric = _diagram_rubric(request_payload)
    system = (
        "You are a whiteboard copilot using a ReAct-style loop: call tools when needed, "
        "read the JSON they return, then either call more tools or answer. "
        f"{tools_rubric}\n"
        f"{diagram_rubric}\n"
        "When you are done gathering information, respond with a single JSON object only "
        "(no markdown, no prose outside JSON). Final turn uses structured JSON output. "
        "Factuality (when tools were used): base my_response on tool output only — "
        "snippets, local hits, or fetch_url text. Do not treat a search title alone as "
        "proof of facts. If fetch_url returns ok:false or unusable text, do not invent "
        "article details; say the page could not be read and use only web_search snippets "
        "or state uncertainty briefly. "
        "Question fit: if the user names a specific product, company, or incident (e.g. "
        "\"Mythos Cloud\") but sources discuss a different entity (e.g. Anthropic's "
        "\"Mythos\" model), say that explicitly in my_response — one short clause — "
        "instead of merging names. "
        "Tone for incidents and security news: when multiple sources or a readable page "
        "agree, you may be descriptive (who, what, when, per those sources). When tools "
        "failed, disagree, or you only have thin headlines, be discreet: use cautious "
        "wording (\"reported\", \"according to…\", \"could not verify here\"), avoid "
        "absolute claims, and keep my_response tight. "
        "Length: queryText often targets ~240 characters for my_response so handwriting "
        "fits the board; when you used web_search or fetch_url for incidents or breaking "
        "news, you may extend to roughly 600-900 characters if needed for accuracy "
        "(outlets, dates, entity mismatch, hedging) — still no rambling. "
        "The user's message begins with instructions in queryText — that text is "
        "authoritative for the JSON shape, including the optional canvasActions array "
        "(create_text, create_geo, create_arrow, create_draw, delete_shapes, move_shapes "
        "in page coordinates). You MUST NOT omit canvasActions when queryText or the "
        "diagram hint requires them; when there is no diagram intent, omit canvasActions. "
        "Required keys at minimum: my_response, what_i_see, layoutStyle, "
        "detected_language, detected_script, script_direction. layoutStyle one of "
        "COLUMNAR|MIND_MAP|RESEARCH_STACK|FLOWING|UNKNOWN. "
        f"Server UTC now: {now_utc}.\n"
    )
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": system},
        {"role": "user", "content": u_content},
    ]
    tools_payload = registry.openai_tools_payload(allowed)
    max_r = _max_agent_tool_rounds()
    if not tools_payload:
        max_r = 0

    max_nudges = _max_uncertainty_nudges()
    last_parsed: dict[str, Any] | None = None

    for attempt in range(max_nudges + 1):
        if time.perf_counter() > t_deadline:
            if last_parsed is not None:
                return last_parsed, tool_trace, usage_rounds
            parsed_t, _, _ = _run_answer_pass(
                messages=messages,
                tools_payload=tools_payload,
                max_r=max_r,
                t_deadline=t_deadline,
                t_api=t_api,
                allowed=allowed,
                on_tool=on_tool,
                tool_trace=tool_trace,
                usage_rounds=usage_rounds,
            )
            return parsed_t, tool_trace, usage_rounds

        parsed, raw, kind = _run_answer_pass(
            messages=messages,
            tools_payload=tools_payload,
            max_r=max_r,
            t_deadline=t_deadline,
            t_api=t_api,
            allowed=allowed,
            on_tool=on_tool,
            tool_trace=tool_trace,
            usage_rounds=usage_rounds,
        )
        last_parsed = parsed

        if kind == "timeout":
            return parsed, tool_trace, usage_rounds
        if kind == "empty":
            return parsed, tool_trace, usage_rounds

        can_nudge = (
            attempt < max_nudges
            and raw is not None
            and _my_response_sounds_uncertain(str(parsed.get("my_response", "")))
            and _web_lookup_tools_enabled(allowed)
            and not _used_web_research(tool_trace)
            and time.perf_counter() <= t_deadline
        )
        if can_nudge:
            messages.append({"role": "assistant", "content": raw})
            messages.append({"role": "user", "content": _nudge_reviewer_text()})
            continue

        return parsed, tool_trace, usage_rounds

    return last_parsed or {}, tool_trace, usage_rounds

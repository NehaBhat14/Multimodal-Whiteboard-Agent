"""OpenAI function-tool schemas and dispatch."""

from __future__ import annotations

import json
import time
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeout
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable

from app.services.tools import fetch_url as fetch_url_mod
from app.services.tools import grep_repo as grep_repo_mod
from app.services.tools import list_dir as list_dir_mod
from app.services.tools import local_index
from app.services.tools import read_file as read_file_mod
from app.services.tools import web_search as web_search_mod

ToolFn = Callable[[dict[str, Any], float], dict[str, Any]]


@dataclass
class ToolSpec:
    name: str
    description: str
    parameters: dict[str, Any]
    handler: ToolFn
    timeout_s: float = 2.5
    default_enabled: bool = True


def _h_time(args: dict[str, Any], deadline: float) -> dict[str, Any]:
    if time.perf_counter() > deadline:
        return {"ok": False, "error": "time budget", "now_utc": None}
    tz = str(args.get("time_zone", "") or "").strip() or "UTC"
    now = datetime.now(timezone.utc)
    return {
        "ok": True,
        "time_zone": tz,
        "now_utc": now.replace(microsecond=0).isoformat(),
    }


def _h_search_local(args: dict[str, Any], deadline: float) -> dict[str, Any]:
    q = str(args.get("query", "") or "")
    k = int(args.get("top_k", 5) or 5)
    return {
        "hits": local_index.search_local_docs(
            q, top_k=max(1, min(k, 10))
        ),
    }


def _h_web(args: dict[str, Any], deadline: float) -> dict[str, Any]:
    q = str(args.get("query", "") or "")
    n = int(args.get("count", 5) or 5)
    return web_search_mod.search_web(q, count=n)


def _h_fetch_url(args: dict[str, Any], deadline: float) -> dict[str, Any]:
    u = str(args.get("url", "") or "")
    return fetch_url_mod.fetch_url(u, max_chars=int(args.get("max_chars", 4000) or 4000))


def _h_read_file(args: dict[str, Any], deadline: float) -> dict[str, Any]:
    return read_file_mod.read_file(
        str(args.get("path", "") or ""),
        max_bytes=int(args.get("max_bytes", 16_000) or 16_000),
    )


def _h_grep(args: dict[str, Any], deadline: float) -> dict[str, Any]:
    return grep_repo_mod.grep_repo(
        str(args.get("pattern", "") or ""),
        glob=str(args.get("glob", "**/*") or "**/*"),
        max_hits=int(args.get("max_hits", 20) or 20),
    )


def _h_list_dir(args: dict[str, Any], deadline: float) -> dict[str, Any]:
    return list_dir_mod.list_dir(str(args.get("path", "") or "."))


def build_registry() -> dict[str, ToolSpec]:
    specs: list[ToolSpec] = [
        ToolSpec(
            name="get_current_time",
            description="Get current date/time in UTC. Use for relative dates like 'yesterday'.",
            parameters={
                "type": "object",
                "properties": {
                    "time_zone": {
                        "type": "string",
                        "description": "Optional IANA zone name; ignored if unknown — UTC returned.",
                    },
                },
            },
            handler=_h_time,
            timeout_s=0.5,
        ),
        ToolSpec(
            name="search_local_docs",
            description="Search local PDFs under the data directory (BM25).",
            parameters={
                "type": "object",
                "required": ["query"],
                "properties": {
                    "query": {"type": "string"},
                    "top_k": {"type": "integer", "default": 5},
                },
            },
            handler=_h_search_local,
            timeout_s=1.5,
        ),
        ToolSpec(
            name="web_search",
            description="Search the public web for current events, news, or facts not in the canvas.",
            parameters={
                "type": "object",
                "required": ["query"],
                "properties": {
                    "query": {"type": "string"},
                    "count": {"type": "integer", "default": 5},
                },
            },
            handler=_h_web,
            timeout_s=22.0,
        ),
        ToolSpec(
            name="fetch_url",
            description=(
                "Read plain text from a public http(s) HTML page after web_search. "
                "If the tool returns ok:false, rely on search snippets — do not invent article text."
            ),
            parameters={
                "type": "object",
                "required": ["url"],
                "properties": {
                    "url": {"type": "string"},
                    "max_chars": {"type": "integer", "default": 4000},
                },
            },
            handler=_h_fetch_url,
            timeout_s=10.0,
        ),
        ToolSpec(
            name="read_file",
            description="Read a small text or code file under the sandbox (relative path).",
            parameters={
                "type": "object",
                "required": ["path"],
                "properties": {
                    "path": {"type": "string"},
                    "max_bytes": {"type": "integer", "default": 16_000},
                },
            },
            handler=_h_read_file,
            timeout_s=1.5,
        ),
        ToolSpec(
            name="grep_repo",
            description="Search file contents in the sandbox with a regex pattern.",
            parameters={
                "type": "object",
                "required": ["pattern"],
                "properties": {
                    "pattern": {"type": "string"},
                    "glob": {"type": "string", "default": "**/*"},
                    "max_hits": {"type": "integer", "default": 20},
                },
            },
            handler=_h_grep,
            timeout_s=1.5,
        ),
        ToolSpec(
            name="list_dir",
            description="List files and subfolders in a sandbox path (non-recursive).",
            parameters={
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Relative path; use '' or '.' for data root",
                    }
                },
            },
            handler=_h_list_dir,
            timeout_s=0.5,
        ),
    ]
    return {s.name: s for s in specs}


def allowed_tool_names_from_request(
    enabled_agent_tools: list[str] | None,
) -> frozenset[str] | None:
    """``None`` → no filter (all tools). Empty list → no tools. Else → intersection with registry."""
    if enabled_agent_tools is None:
        return None
    reg = build_registry()
    return frozenset(n for n in enabled_agent_tools if n in reg)


def openai_tools_payload(allowed: frozenset[str] | None = None) -> list[dict[str, Any]]:
    specs = list(build_registry().values())
    if allowed is not None:
        specs = [s for s in specs if s.name in allowed]
    return [
        {"type": "function", "function": {"name": s.name, "description": s.description, "parameters": s.parameters}}  # noqa: E501
        for s in specs
    ]


def run_tool(
    name: str,
    arguments_json: str,
    deadline: float,
    extra_ms: list[float] | None = None,
    allowed: frozenset[str] | None = None,
) -> dict[str, Any]:
    reg = build_registry()
    if name not in reg:
        return {"ok": False, "error": f"unknown tool: {name}"}
    if allowed is not None and name not in allowed:
        return {"ok": False, "error": f"tool not enabled for this request: {name}"}
    sp = reg[name]
    t0 = time.perf_counter()
    try:
        args = (
            json.loads(arguments_json) if (arguments_json or "").strip() else {}
        )
    except (json.JSONDecodeError, TypeError) as e:
        return {
            "ok": False,
            "error": f"bad arguments JSON: {e!s}",
        }
    if not isinstance(args, dict):
        args = {}
    try:
        if time.perf_counter() > deadline:
            return {"ok": False, "error": "request deadline before tool start"}

        def _do() -> dict[str, Any]:
            return sp.handler(args, deadline)

        with ThreadPoolExecutor(max_workers=1) as ex:
            fut = ex.submit(_do)
            out = fut.result(timeout=sp.timeout_s)
    except FuturesTimeout:  # noqa: PERF203
        return {
            "ok": False,
            "error": f"tool {name!s} timeout after {sp.timeout_s!s}s",
        }
    except (OSError, ValueError, TypeError) as e:
        return {"ok": False, "error": str(e)[:2000]}
    if extra_ms is not None:
        extra_ms.append((time.perf_counter() - t0) * 1000.0)
    return out

"""DuckDuckGo instant-answer or HTML fallback; optional Brave key."""

from __future__ import annotations

import json
import os
import time
import urllib.parse
import urllib.request
from typing import Any

from app.services.tools.lru import lru_get, lru_set, make_lru

_cache: Any = make_lru()
_cache_lock: Any = __import__("threading").Lock()


def _normalize_ddgs_rows(rows: list[Any]) -> list[dict[str, str]]:
    """Map DDGS ``text`` / ``news`` rows to our result shape."""
    out: list[dict[str, str]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        title = str(row.get("title") or "")[:200]
        href = str(row.get("href") or row.get("url") or row.get("link") or "")[:500]
        body = str(row.get("body") or row.get("snippet") or "")[:2000]
        if not (title or body or href):
            continue
        out.append(
            {
                "title": title or (href[:80] if href else "Hit"),
                "url": href or "https://duckduckgo.com/",
                "snippet": body,
            }
        )
    return out


def _ddg_text_search(q: str, max_results: int) -> list[dict[str, str]]:
    """Web results via ``ddgs`` (text + news fallbacks).

    ``backend=auto`` often hits Wikipedia first and returns nothing for breaking
    news; use real web engines by default. Requires ``pip install ddgs``.
    """
    try:
        from ddgs import DDGS
        from ddgs.exceptions import DDGSException
    except ImportError:
        return []

    cap = max(1, min(max_results, 10))
    timeout = int(os.getenv("DDGS_TIMEOUT", "15") or "15")
    timeout = max(5, min(timeout, 25))
    backend = (
        os.getenv(
            "DDGS_TEXT_BACKEND",
            "yahoo,google,mojeek,duckduckgo",
        )
        or "yahoo,google,mojeek,duckduckgo"
    ).strip()

    out: list[dict[str, str]] = []
    try:
        with DDGS(timeout=timeout) as ddgs:
            try:
                rows = ddgs.text(q, max_results=cap, backend=backend)
                out = _normalize_ddgs_rows(list(rows))
            except DDGSException:
                out = []
            if not out:
                try:
                    rows = ddgs.news(q, max_results=cap)
                    out = _normalize_ddgs_rows(list(rows))
                except DDGSException:
                    pass
    except (DDGSException, OSError, TypeError, ValueError, RuntimeError, KeyError):
        return []
    return out[:cap]


def _ddg_instant(q: str) -> list[dict[str, str]]:
    url = (
        "https://api.duckduckgo.com/?"
        + urllib.parse.urlencode(
            {
                "q": q,
                "format": "json",
                "no_html": "1",
                "skip_disambig": "1",
            }
        )
    )
    req = urllib.request.Request(  # noqa: S310
        url,
        headers={"User-Agent": "WhiteBoardAgent/0.1 (reasoner tools)"},
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=4.0) as r:  # noqa: S310
        data = json.loads(r.read().decode("utf-8", errors="replace"))
    out: list[dict[str, str]] = []
    a = (data or {}).get("AbstractText")
    u = (data or {}).get("AbstractURL", "")
    if a:
        out.append(
            {
                "title": (data or {}).get("Heading", "Summary")[:200],
                "url": u or "https://duckduckgo.com/",
                "snippet": a[:2000],
            }
        )
    for t in (data or {}).get("RelatedTopics", []) or []:
        if isinstance(t, dict) and "Text" in t and "FirstURL" in t:
            out.append(
                {
                    "title": t.get("Text", "")[:120],
                    "url": t.get("FirstURL", "")[:500],
                    "snippet": t.get("Text", "")[:2000],
                }
            )
        if len(out) >= 5:
            break
    return out


def _brave(q: str) -> list[dict[str, str]] | None:
    key = os.getenv("BRAVE_API_KEY", "").strip()
    if not key:
        return None
    u = "https://api.search.brave.com/res/v1/web/search"
    p = urllib.parse.urlencode({"q": q, "count": 5})
    req = urllib.request.Request(  # noqa: S310
        f"{u}?{p}",
        headers={"X-Subscription-Token": key, "Accept": "application/json"},
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=4.0) as r:  # noqa: S310
        data = json.loads(r.read().decode("utf-8", errors="replace"))
    web = (data or {}).get("web", {}) or {}
    results = web.get("results") or []
    out: list[dict[str, str]] = []
    for it in results[:5]:
        if not isinstance(it, dict):
            continue
        out.append(
            {
                "title": str(it.get("title", ""))[:200],
                "url": str(it.get("url", ""))[:500],
                "snippet": str(it.get("description", ""))[:2000],
            }
        )
    return out


def search_web(query: str, count: int = 5) -> dict[str, Any]:
    q = (query or "").strip()
    if not q:
        return {"query": "", "results": [], "elapsed_ms": 0.0}
    ckey = ("web", f"{q}|{count}")
    with _cache_lock:
        hit = lru_get(_cache, ckey)
    if hit is not None:
        return hit
    t0 = time.perf_counter()
    items: list[dict[str, str]] = []
    b = _brave(q)
    if b:
        items = b
    if not items:
        items = _ddg_instant(q)
    if not items:
        items = _ddg_text_search(q, count)
    if not items:
        items = [
            {
                "title": "No results",
                "url": "https://duckduckgo.com/",
                "snippet": f"No search hits for: {q[:200]}",
            }
        ]
    res = {
        "query": q,
        "results": items[: max(1, min(count, 8))],
        "elapsed_ms": (time.perf_counter() - t0) * 1000.0,
    }
    with _cache_lock:
        lru_set(_cache, ckey, res)
    return res  # type: ignore[return-value]

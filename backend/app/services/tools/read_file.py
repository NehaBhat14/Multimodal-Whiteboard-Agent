"""Read a text-like file from the sandbox (bytes capped)."""

from __future__ import annotations

from typing import Any

from app.services.tools.path_sandbox import resolve_safe_relpath


def read_file(path: str, max_bytes: int = 16_000) -> dict[str, Any]:
    rel = (path or "").strip()
    if not rel:
        return {"ok": False, "error": "path required", "text": ""}
    try:
        p = resolve_safe_relpath(rel)
    except ValueError as e:
        return {"ok": False, "error": str(e), "text": ""}
    if not p.is_file():
        return {"ok": False, "error": "not a file or not found", "text": ""}
    try:
        b = p.read_bytes()[: max(1, min(int(max_bytes), 400_000))]
    except OSError as e:
        return {"ok": False, "error": str(e)[:300], "text": ""}
    for enc in ("utf-8", "utf-8-sig", "latin-1"):
        try:
            text = b.decode(enc, errors="replace")
            return {"ok": True, "path": rel, "text": text}
        except (UnicodeError, TypeError, AttributeError, LookupError, ValueError, OSError):
            continue
    return {"ok": True, "path": rel, "text": b.decode("utf-8", errors="replace")}

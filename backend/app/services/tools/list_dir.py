"""List directory entries (non-recursive) in the sandbox."""

from __future__ import annotations

import os
from typing import Any

from app.services.tools.path_sandbox import resolve_safe_relpath


def list_dir(path: str) -> dict[str, Any]:
    relp = (path or "").strip()
    if relp in (".", "./", ""):
        p = resolve_safe_relpath("")
    else:
        try:
            p = resolve_safe_relpath(relp)
        except ValueError as e:
            return {"ok": False, "error": str(e), "entries": []}
    if not p.is_dir():
        return {"ok": False, "error": "not a directory", "entries": []}
    out: list[dict[str, str]] = []
    for name in sorted(os.listdir(p))[:200]:
        fp = p / name
        try:
            t = "dir" if fp.is_dir() else "file"
        except OSError:
            t = "?"
        out.append({"name": name, "type": t})
    return {"ok": True, "path": relp or ".", "entries": out}

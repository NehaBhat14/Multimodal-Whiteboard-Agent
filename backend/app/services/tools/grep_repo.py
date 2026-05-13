"""Ripgrep over sandbox when available; else Python line scan. Optional glob."""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any

from app.services.tools.sandbox_config import get_sandbox_root


def grep_repo(
    pattern: str, glob: str = "**/*", max_hits: int = 20
) -> dict[str, Any]:
    p = (pattern or "").strip()
    if not p or len(p) > 200:
        return {
            "ok": False,
            "error": "pattern too long or empty",
            "matches": [],
        }
    root = get_sandbox_root()
    t0 = time.perf_counter()
    rg = shutil.which("rg")
    if rg:
        try:
            r = subprocess.run(  # noqa: S603
                [
                    rg,
                    "-n",
                    "--no-heading",
                    "-S",
                    "--max-count",
                    str(max(1, min(int(max_hits) * 2, 200))),
                    "-e",
                    p,
                    str(root),
                    "--glob",
                    glob,
                ],
                capture_output=True,
                text=True,
                timeout=1.4,
                check=False,
            )
            out = (r.stdout or "")[:20_000]
        except (subprocess.TimeoutExpired, OSError) as e:
            out = f"rg error: {e!s}\n"
    else:
        out = _python_grep(root, p, glob, int(max_hits))
    return {
        "ok": True,
        "pattern": p,
        "output": out[:20_000],
        "elapsed_ms": (time.perf_counter() - t0) * 1000.0,
    }


def _python_grep(root: Path, pattern: str, glob: str, max_hits: int) -> str:
    try:
        rgx = re.compile(pattern, re.IGNORECASE | re.MULTILINE)
    except re.error as e:
        return f"Invalid regex: {e!s}\n"
    lines_out: list[str] = []
    n = 0
    g = (glob or "**/*").strip() or "**/*"
    if g in ("**/*", "**", "*", "*.*"):
        files = (p for p in root.rglob("*") if p.is_file() and not p.is_symlink())
    else:
        try:
            files = (p for p in root.glob(g) if p.is_file() and not p.is_symlink())
        except (OSError, TypeError, ValueError):
            files = iter(())
    for f in files:
        if f.stat().st_size > 1_200_000:
            continue
        try:
            t = f.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for i, line in enumerate(t.splitlines(), 1):
            if rgx.search(line):
                rel = f.relative_to(root)
                lines_out.append(f"{rel.as_posix()}:{i}:{line[:400]}")
                n += 1
            if n >= max_hits:
                return "\n".join(lines_out) + "\n"
    return "\n".join(lines_out) or "(no matches)\n"

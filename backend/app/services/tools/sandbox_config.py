"""Configurable root for read-only agent tools (default: backend/data)."""

from __future__ import annotations

import os
from pathlib import Path


def get_sandbox_root() -> Path:
    raw = os.getenv("AGENT_CODE_TOOLS_SCOPE", "").strip()
    if raw:
        p = Path(raw).expanduser().resolve()
    else:
        # backend/app/services/tools/sandbox_config.py -> parents[3] = backend
        p = Path(__file__).resolve().parents[3] / "data"
    if not p.is_dir():
        p.mkdir(parents=True, exist_ok=True)
    return p

"""Minimal `.env` loader used to configure local development."""

from __future__ import annotations

from pathlib import Path
import os


def load_env_file(path: Path) -> None:
    """Load KEY=VALUE lines from `.env` into process env if not already set."""
    if not path.exists():
        return

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not key:
            continue

        # Remove optional single/double quotes around values.
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]

        os.environ.setdefault(key, value)

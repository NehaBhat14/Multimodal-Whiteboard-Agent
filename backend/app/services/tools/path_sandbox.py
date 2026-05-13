"""Resolve paths under the configured sandbox root; block traversal and symlinks."""

from __future__ import annotations

from pathlib import Path

from app.services.tools.sandbox_config import get_sandbox_root


def resolve_safe_relpath(rel: str) -> Path:
    """Return absolute path under the sandbox, or raise ValueError."""
    rel = (rel or "").replace("\\", "/").strip()
    if ".." in rel.split("/") or rel.startswith(("/", "\\")):
        raise ValueError("path must be relative to sandbox with no '..'")
    root = get_sandbox_root().resolve()
    if not rel or rel in (".", "./"):
        return root
    path = (root / rel).resolve()
    try:
        path.relative_to(root)
    except ValueError as e:
        raise ValueError("path outside sandbox") from e
    if path.is_symlink():
        raise ValueError("symlinks are not allowed")
    return path

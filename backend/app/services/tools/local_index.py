"""BM25 over PDF text chunks in backend/data (lazy index + optional disk cache)."""

from __future__ import annotations

import hashlib
import json
import re
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from pypdf import PdfReader
from rank_bm25 import BM25Okapi

from app.services.tools.sandbox_config import get_sandbox_root

_INDEX_DIR = "local_docs_index"
_MAX_CHUNKS = 50_000
_CACHE_NAME = "bm25_state.json"

_token_re = re.compile(r"[a-zA-Z0-9_]+", re.ASCII)

_lock: Any = __import__("threading").Lock()
_state: dict[str, Any] = {"ready": False, "chunks": []}


@dataclass
class LocalChunk:
    doc_id: str
    page: int
    path: str
    text: str


def _tokenize(s: str) -> list[str]:
    return [t.lower() for t in _token_re.findall(s) if len(t) > 1]


def _pdf_text(path: Path) -> list[tuple[int, str]]:
    out: list[tuple[int, str]] = []
    try:
        reader = PdfReader(str(path))
    except OSError:
        return out
    for i, page in enumerate(getattr(reader, "pages", []) or []):
        try:
            t = (page.extract_text() or "")[:80_000]
        except OSError:
            t = ""
        t = re.sub(r"\s+", " ", t).strip()
        if t:
            out.append((i + 1, t))
    return out


def _chunk_text(page: int, text: str, doc_id: str, rel_path: str) -> list[LocalChunk]:
    # ~1000 char chunks, 200 overlap
    size = 1000
    overlap = 200
    chunks: list[LocalChunk] = []
    if len(text) <= size:
        chunks.append(LocalChunk(doc_id=doc_id, page=page, path=rel_path, text=text))
        return chunks
    for start in range(0, len(text), size - overlap):
        part = text[start : start + size]
        if not part.strip():
            break
        chunks.append(LocalChunk(doc_id=doc_id, page=page, path=rel_path, text=part))
        if start + size >= len(text):
            break
    return chunks


def _meta_path(root: Path) -> Path:
    d = root / _INDEX_DIR
    d.mkdir(parents=True, exist_ok=True)
    return d / _CACHE_NAME


def _should_rebuild(root: Path) -> bool:
    meta = _meta_path(root)
    if not meta.is_file():
        return True
    try:
        stored = json.loads(meta.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return True
    files: dict[str, int] = stored.get("mtimes", {})
    for p in root.glob("*.pdf"):
        if not p.is_file() or p.is_symlink():
            continue
        key = str(p.relative_to(root))
        m = int(p.stat().st_mtime)
        if files.get(key) != m:
            return True
    return False


def _build_index() -> None:
    root = get_sandbox_root()
    all_chunks: list[LocalChunk] = []
    for p in sorted(root.glob("*.pdf")):
        if not p.is_file() or p.is_symlink():
            continue
        rel = p.relative_to(root).as_posix()
        h = hashlib.sha256(str(rel).encode("utf-8", errors="replace")).hexdigest()[:12]
        for page, text in _pdf_text(p):
            for ch in _chunk_text(page, text, h, rel):
                all_chunks.append(ch)
        if len(all_chunks) >= _MAX_CHUNKS:
            break
    tokenized = [_tokenize(c.text) for c in all_chunks]
    if not all_chunks or not any(tokenized):
        with _lock:
            _state["ready"] = True
            _state["chunks"] = []
            _state["bm25"] = None
            _state["built_at"] = time.time()
        return
    bm25 = BM25Okapi(tokenized)
    with _lock:
        _state["ready"] = True
        _state["chunks"] = [asdict(c) for c in all_chunks]
        _state["bm25"] = bm25
        _state["tokenized"] = tokenized
        _state["built_at"] = time.time()
    try:
        mtimes = {}
        for p2 in root.glob("*.pdf"):
            if p2.is_file() and not p2.is_symlink():
                mtimes[str(p2.relative_to(root))] = int(p2.stat().st_mtime)
        _meta_path(root).write_text(
            json.dumps({"version": 1, "mtimes": mtimes}, indent=0),
            encoding="utf-8",
        )
    except OSError:
        pass


def _ensure() -> None:
    with _lock:
        if _state.get("ready"):
            return
    _build_index()


def search_local_docs(query: str, top_k: int = 5) -> list[dict[str, Any]]:
    """Return top BM25 hits as dicts: doc_id, path, page, score, snippet."""
    q = (query or "").strip()
    if not q:
        return []
    _ensure()
    with _lock:
        bm25 = _state.get("bm25")
        chlist = _state.get("chunks") or []
    if not bm25 or not chlist:
        return [
            {
                "doc_id": "",
                "path": "",
                "page": 0,
                "score": 0.0,
                "snippet": "No indexed local documents. Add PDFs under the data directory.",
            }
        ]
    q_tok = _tokenize(q)
    if not q_tok:
        return []
    scores = bm25.get_scores(q_tok)  # type: ignore[union-attr]
    idxs = sorted(range(len(scores)), key=lambda i: float(scores[i]), reverse=True)[
        : max(1, min(top_k, 10))
    ]
    out: list[dict[str, Any]] = []
    for i in idxs:
        c = chlist[i]
        snippet = (c.get("text") or "")[:500]
        out.append(
            {
                "doc_id": c.get("doc_id", ""),
                "path": c.get("path", ""),
                "page": c.get("page", 0),
                "score": float(scores[i]) if i < len(scores) else 0.0,
                "snippet": snippet,
            }
        )
    return out

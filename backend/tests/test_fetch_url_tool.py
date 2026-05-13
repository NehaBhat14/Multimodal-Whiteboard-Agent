"""fetch_url HTML extraction and error paths."""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import MagicMock

import pytest

from app.services.tools import fetch_url as fu


class _Hdr:
    def get_content_charset(self) -> str:
        return "utf-8"


class _Resp:
    def __init__(self, data: bytes, headers: Any = None) -> None:
        self._data = data
        self.headers = headers or _Hdr()

    def read(self, n: int = -1) -> bytes:
        return self._data

    def __enter__(self) -> _Resp:
        return self

    def __exit__(self, *a: object) -> None:
        return None


def test_fetch_url_extracts_visible_text(monkeypatch: pytest.MonkeyPatch) -> None:
    para = b"Hello world news. " * 8
    html = (
        b"<html><head><title>T</title></head><body><p>"
        + para
        + b"</p></body></html>"
    )
    monkeypatch.setattr(
        fu.urllib.request,
        "urlopen",
        lambda *a, **k: _Resp(html),
    )
    out = fu.fetch_url("https://example.com/a", max_chars=500)
    assert out["ok"] is True
    assert "Hello world news" in out["text"]


def test_fetch_url_rejects_garbage_body(monkeypatch: pytest.MonkeyPatch) -> None:
    raw = bytes((i % 5) for i in range(3000))
    monkeypatch.setattr(
        fu.urllib.request,
        "urlopen",
        lambda *a, **k: _Resp(raw),
    )
    out = fu.fetch_url("https://example.com/b", max_chars=500)
    assert out["ok"] is False
    assert "noisy" in (out.get("error") or "").lower() or "empty" in (
        out.get("error") or ""
    ).lower()


def test_fetch_url_http_error(monkeypatch: pytest.MonkeyPatch) -> None:
    import urllib.error

    def boom(*a: object, **k: object) -> None:
        raise urllib.error.HTTPError(
            "https://x",
            429,
            "Too Many",
            hdrs=MagicMock(),
            fp=None,
        )

    monkeypatch.setattr(fu.urllib.request, "urlopen", boom)
    out = fu.fetch_url("https://example.com/c", max_chars=100)
    assert out["ok"] is False
    assert "429" in (out.get("error") or "")


def test_fetch_url_tool_json_serializable(monkeypatch: pytest.MonkeyPatch) -> None:
    html = b"<html><body>OK text " + b"x" * 200 + b"</body></html>"
    monkeypatch.setattr(
        fu.urllib.request,
        "urlopen",
        lambda *a, **k: _Resp(html),
    )
    out = fu.fetch_url("https://example.com/d", max_chars=8000)
    json.dumps(out)

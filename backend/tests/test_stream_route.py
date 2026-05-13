"""SSE /reason/stream with mock provider."""

import json
import os

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def _mock_only(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("REASONING_PROVIDER", "mock")
    if "REASONER_STREAM_AGENT" in os.environ:
        monkeypatch.delenv("REASONER_STREAM_AGENT", raising=False)


def test_stream_reason_sends_stages_and_final(_mock_only, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("REASONING_PROVIDER", "mock")
    client = TestClient(app)
    with client.stream(
        "POST",
        "/api/v1/reason/stream",
        json={
            "imageBase64": "x",
            "spatial": {"x": 0, "y": 0, "width": 1, "height": 1},
            "queryText": "Q",
        },
    ) as r:
        assert r.status_code == 200
        buf = b""
        for c in r.iter_bytes():
            buf += c
    text = buf.decode("utf-8", errors="replace")
    assert "final" in text
    lines = [L for L in text.split("\n\n") if L.strip()]
    parsed: list[dict] = []
    for L in lines:
        if L.startswith("data: "):
            j = json.loads(L[6:].strip())
            parsed.append(j)
    final = [p for p in parsed if p.get("type") == "final"][-1]
    body = final.get("body") or {}
    assert body.get("my_response") == "mock my_response"
    assert "stages" in str(buf) or any(p.get("type") == "stage" for p in parsed)

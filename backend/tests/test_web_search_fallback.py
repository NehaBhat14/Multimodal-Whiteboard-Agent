"""web_search layered backends (Brave → instant → text search)."""

from app.services.tools import web_search as ws


def test_search_web_uses_text_search_when_instant_empty(monkeypatch: object) -> None:
    monkeypatch.setattr(ws, "_brave", lambda q: None)
    monkeypatch.setattr(ws, "_ddg_instant", lambda q: [])
    monkeypatch.setattr(
        ws,
        "_ddg_text_search",
        lambda q, n: [
            {
                "title": "Example hit",
                "url": "https://example.com",
                "snippet": "Snippet body",
            }
        ],
    )
    out = ws.search_web("unique test query xyz", count=3)
    assert isinstance(out, dict)
    assert out["results"][0]["title"] == "Example hit"
    assert "elapsed_ms" in out


def test_search_web_placeholder_only_when_all_empty(monkeypatch: object) -> None:
    monkeypatch.setattr(ws, "_brave", lambda q: None)
    monkeypatch.setattr(ws, "_ddg_instant", lambda q: [])
    monkeypatch.setattr(ws, "_ddg_text_search", lambda q, n: [])
    out = ws.search_web("another unique query abc", count=2)
    assert out["results"][0]["title"] == "No results"

"""Uncertainty heuristics and web nudge preconditions for reasoner_agent."""

from __future__ import annotations

from app.services.reasoner_agent import (
    _max_uncertainty_nudges,
    _my_response_sounds_uncertain,
    _used_web_research,
    _web_lookup_tools_enabled,
)


def test_my_response_sounds_uncertain_dark_knight_style() -> None:
    assert _my_response_sounds_uncertain(
        'I don\'t know who the lead actor is, but "The Dark Knight" stars famous actors.'
    )


def test_my_response_sounds_uncertain_negative_descriptive() -> None:
    assert not _my_response_sounds_uncertain(
        "The board shows two columns with questions and answers in blue ink."
    )


def test_web_lookup_tools_enabled() -> None:
    assert _web_lookup_tools_enabled(None) is True
    assert _web_lookup_tools_enabled(frozenset({"web_search"})) is True
    assert _web_lookup_tools_enabled(frozenset({"grep_repo"})) is False


def test_used_web_research() -> None:
    assert not _used_web_research([])
    assert _used_web_research([{"name": "web_search", "args": "{}"}])
    assert _used_web_research([{"name": "fetch_url", "args": "{}"}])
    assert not _used_web_research([{"name": "grep_repo", "args": "{}"}])


def test_max_uncertainty_nudges_default_and_clamp(monkeypatch: object) -> None:
    monkeypatch.delenv("REASONER_AGENT_UNCERTAINTY_NUDGES", raising=False)
    assert _max_uncertainty_nudges() == 1

    monkeypatch.setenv("REASONER_AGENT_UNCERTAINTY_NUDGES", "0")
    assert _max_uncertainty_nudges() == 0

    monkeypatch.setenv("REASONER_AGENT_UNCERTAINTY_NUDGES", "5")
    assert _max_uncertainty_nudges() == 3

    monkeypatch.setenv("REASONER_AGENT_UNCERTAINTY_NUDGES", "abc")
    assert _max_uncertainty_nudges() == 1

"""Session context prefix (009) — answer pass only."""

from app.models.schemas import (
    ConversationTurn,
    SpatialPayload,
    VlmInferenceRequest,
)
from app.services.reasoner import _build_spatial_only_query_text, build_session_text_prefix


def test_build_session_text_prefix_includes_turns_and_follow_up() -> None:
    req = VlmInferenceRequest(
        imageBase64="x",
        spatial=SpatialPayload(x=0, y=0, width=10, height=10),
        queryText="INSTR",
        conversationContext=[
            ConversationTurn(
                at="2026-01-01T00:00:00Z",
                whatISee="user asked about X",
                myResponse="here is X",
            )
        ],
        userMessage="now explain Y",
    )
    s = build_session_text_prefix(req)
    assert "[Conversation so far]" in s
    assert "user asked about X" in s
    assert "here is X" in s
    assert "[User follow-up]" in s
    assert "now explain Y" in s


def test_build_session_text_prefix_empty_when_no_context() -> None:
    req = VlmInferenceRequest(
        imageBase64="x",
        spatial=SpatialPayload(x=0, y=0, width=1, height=1),
        queryText="Q",
    )
    assert build_session_text_prefix(req) == ""


def test_spatial_planner_query_excludes_conversation_block() -> None:
    req = VlmInferenceRequest(
        imageBase64="a",
        spatial=SpatialPayload(x=0, y=0, width=1, height=1),
        queryText="ignored",
        conversationContext=[
            ConversationTurn(at="t", whatISee="SECRET", myResponse="R")
        ],
        # Unique token: base spatial prompt also contains the word "follow" (e.g. "follow it")
        userMessage="USER_FOLLOWUP_TOKEN_009",
    )
    text = _build_spatial_only_query_text(req)
    assert "[Conversation so far]" not in text
    assert "SECRET" not in text
    assert "USER_FOLLOWUP_TOKEN_009" not in text

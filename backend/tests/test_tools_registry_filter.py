"""Agent tool allowlist from request (enabledAgentTools)."""

from app.models.schemas import SpatialPayload, VlmInferenceRequest
from app.services.tools import registry


def test_allowed_tool_names_none_means_all() -> None:
    assert registry.allowed_tool_names_from_request(None) is None


def test_allowed_tool_names_empty_set() -> None:
    assert registry.allowed_tool_names_from_request([]) == frozenset()


def test_allowed_tool_names_filters_unknown() -> None:
    assert registry.allowed_tool_names_from_request(
        ["get_current_time", "not_a_real_tool"]
    ) == frozenset({"get_current_time"})


def test_openai_tools_payload_respects_allowlist() -> None:
    all_n = len(registry.openai_tools_payload())
    one = registry.openai_tools_payload(frozenset({"get_current_time"}))
    assert all_n >= 2
    assert len(one) == 1
    assert one[0]["function"]["name"] == "get_current_time"


def test_run_tool_rejects_disallowed_name() -> None:
    out = registry.run_tool(
        "web_search",
        '{"query":"x"}',
        __import__("time").perf_counter() + 5.0,
        allowed=frozenset({"get_current_time"}),
    )
    assert out.get("ok") is False
    assert "not enabled" in str(out.get("error", ""))


def test_vlm_request_accepts_enabled_agent_tools() -> None:
    req = VlmInferenceRequest(
        imageBase64="",
        spatial=SpatialPayload(x=0, y=0, width=1, height=1),
        queryText="q",
        enabledAgentTools=["grep_repo"],
    )
    assert req.enabledAgentTools == ["grep_repo"]

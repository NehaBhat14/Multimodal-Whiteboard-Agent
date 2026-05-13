"""API contract and validation tests for POST /api/v1/reason."""

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

VALID_PAYLOAD = {
    "imageBase64": "ZmFrZS1pbWFnZS1ieXRlcw==",
    "spatial": {"x": 120.0, "y": 48.0, "width": 320.0, "height": 180.0},
    "queryText": "PLACEHOLDER_TEXT_QUERY",
}

VALID_PAYLOAD_WITH_PLACEMENT_CONTEXT = {
    **VALID_PAYLOAD,
    "placementContext": {
        "divider_intent": False,
        "split_column_context": False,
        "script_direction": "UNKNOWN",
        "width_profile": {
            "w_avg": 1195.49,
            "min_width": 1195.49,
            "max_width": 1195.49,
            "sample_count": 30,
        },
    },
}

VALID_PAYLOAD_WITH_SPATIAL_CONTEXT_IMAGE = {
    **VALID_PAYLOAD,
    "spatialContextImageBase64": "ZmFrZS1mdWxsLWNhbnZhcy1ieXRlcw==",
}

VALID_PAYLOAD_WITH_SESSION = {
    **VALID_PAYLOAD,
    "conversationContext": [
        {
            "at": "2026-01-01T00:00:00.000Z",
            "whatISee": "see",
            "myResponse": "resp",
        }
    ],
    "userMessage": "follow up",
}


@pytest.fixture(autouse=True)
def force_mock_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep backend tests deterministic and offline."""
    monkeypatch.setenv("REASONING_PROVIDER", "mock")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)


def test_reason_valid_payload_returns_200_with_echoed_coordinates_and_lifecycle() -> None:
    """Valid request returns 200 with mock text, echoed spatial, and lifecycle fields."""
    response = client.post("/api/v1/reason", json=VALID_PAYLOAD)
    assert response.status_code == 200
    data = response.json()
    assert data["my_response"] == "mock my_response"
    assert data["what_i_see"] == "mock what_i_see"
    assert data["spatial"]["x"] == 120.0
    assert data["spatial"]["y"] == 48.0
    assert data["spatial"]["width"] == 320.0
    assert data["spatial"]["height"] == 180.0
    assert "status" in data and data["status"]
    assert "started_at" in data and data["started_at"]
    assert "finished_at" in data and data["finished_at"]
    assert "timings" in data
    timings = data["timings"]
    assert timings["provider"] == "mock"
    assert timings["inference_ms"] == 0.0
    assert timings["parse_ms"] == 0.0
    assert isinstance(timings["total_ms"], (int, float))
    assert timings["total_ms"] >= 0.0
    # semantic hint keys should always appear in the response
    # schema, even when the mock provider returns None for them.
    assert "layoutStyle" in data
    assert "detected_language" in data
    assert "detected_script" in data
    assert "script_direction" in data
    assert "intent_hint" in data
    assert "preferred_side" in data
    assert "placement_mode" in data
    assert "target_column_index" in data
    assert "spatial_confidence" in data
    assert data["layoutStyle"] is None
    assert data["detected_language"] is None
    assert data["detected_script"] is None
    assert data["script_direction"] is None
    assert data["intent_hint"] is None
    assert data["preferred_side"] is None
    assert data["placement_mode"] is None
    assert data["target_column_index"] is None
    assert data["spatial_confidence"] is None


def test_reason_accepts_optional_placement_context_payload() -> None:
    """Request with placementContext should validate and return 200."""
    response = client.post("/api/v1/reason", json=VALID_PAYLOAD_WITH_PLACEMENT_CONTEXT)
    assert response.status_code == 200
    data = response.json()
    assert data["my_response"] == "mock my_response"


def test_reason_accepts_optional_spatial_context_image_payload() -> None:
    """Request with spatialContextImageBase64 should validate and return 200."""
    response = client.post("/api/v1/reason", json=VALID_PAYLOAD_WITH_SPATIAL_CONTEXT_IMAGE)
    assert response.status_code == 200
    data = response.json()
    assert data["my_response"] == "mock my_response"


def test_reason_accepts_optional_conversation_context_and_user_message() -> None:
    """Request with conversationContext + userMessage should validate and return 200 (mock)."""
    response = client.post("/api/v1/reason", json=VALID_PAYLOAD_WITH_SESSION)
    assert response.status_code == 200
    data = response.json()
    assert data["my_response"] == "mock my_response"


def test_parse_dual_response_extracts_layout_hints() -> None:
    """_parse_dual_response surfaces layoutStyle + detected_language when present."""
    from app.services.reasoner import _parse_dual_response

    raw = (
        '{"my_response": "A", "what_i_see": "B", '
        '"layoutStyle": "COLUMNAR", "detected_language": "hi", '
        '"detected_script": "Devanagari", "script_direction": "LTR", '
        '"intent_hint": "comparison", "preferred_side": "right", '
        '"placement_mode": "cross_divider", '
        '"target_column_index": 1, "spatial_confidence": 0.87}'
    )
    out = _parse_dual_response(raw)
    assert out["my_response"] == "A"
    assert out["what_i_see"] == "B"
    assert out["layoutStyle"] == "COLUMNAR"
    assert out["detected_language"] == "hi"
    assert out["detected_script"] == "Devanagari"
    assert out["script_direction"] == "LTR"
    assert out["intent_hint"] == "comparison"
    assert out["preferred_side"] == "right"
    assert out["placement_mode"] == "cross_divider"
    assert out["target_column_index"] == 1
    assert out["spatial_confidence"] == 0.87


def test_parse_dual_response_drops_malformed_hints() -> None:
    """Non-string hint values are dropped to None rather than breaking parse."""
    from app.services.reasoner import _parse_dual_response

    raw = (
        '{"my_response": "A", "what_i_see": "B", '
        '"layoutStyle": 42, "detected_language": null}'
    )
    out = _parse_dual_response(raw)
    assert out["my_response"] == "A"
    assert out["layoutStyle"] is None
    assert out["detected_language"] is None


def test_reason_cors_allows_localhost_5173() -> None:
    """CORS preflight from localhost:5173 is allowed."""
    response = client.options(
        "/api/v1/reason",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert response.status_code in (200, 204)
    assert "access-control-allow-origin" in [h.lower() for h in response.headers]
    # For POST with Origin, response should include CORS headers
    post_response = client.post(
        "/api/v1/reason", json=VALID_PAYLOAD, headers={"Origin": "http://localhost:5173"}
    )
    assert "access-control-allow-origin" in [h.lower() for h in post_response.headers]


def test_reason_missing_spatial_width_returns_422() -> None:
    """Request missing spatial.width returns 422 validation error."""
    invalid = {
        "imageBase64": "ZmFrZQ==",
        "spatial": {"x": 0.0, "y": 0.0, "height": 100.0},
        "queryText": "PLACEHOLDER_TEXT_QUERY",
    }
    response = client.post("/api/v1/reason", json=invalid)
    assert response.status_code == 422
    data = response.json()
    assert "detail" in data
    assert any("width" in str(d).lower() for d in data["detail"])


def test_reason_non_numeric_coordinates_returns_422() -> None:
    """Request with non-numeric coordinates returns 422 validation error."""
    invalid = {
        "imageBase64": "ZmFrZQ==",
        "spatial": {"x": "not-a-number", "y": 0.0, "width": 100.0, "height": 100.0},
        "queryText": "PLACEHOLDER_TEXT_QUERY",
    }
    response = client.post("/api/v1/reason", json=invalid)
    assert response.status_code == 422
    data = response.json()
    assert "detail" in data


def test_reason_openai_provider_without_key_returns_502(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """OpenAI provider should fail with 502 when API key is missing."""
    monkeypatch.setenv("REASONING_PROVIDER", "openai")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    response = client.post("/api/v1/reason", json=VALID_PAYLOAD)
    assert response.status_code == 502
    data = response.json()
    assert "detail" in data
    assert "OPENAI_API_KEY" in data["detail"]

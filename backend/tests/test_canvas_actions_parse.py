"""Tests for canvasActions parsing in reasoner._parse_dual_response."""

import json

from app.services import reasoner as reas


def test_parse_dual_response_includes_valid_canvas_actions() -> None:
    raw = json.dumps(
        {
            "my_response": "hi",
            "what_i_see": "see",
            "layoutStyle": "UNKNOWN",
            "canvasActions": [
                {
                    "_type": "create_text",
                    "x": 1.5,
                    "y": 2,
                    "text": "Label",
                },
                {
                    "_type": "delete_shapes",
                    "shapeIds": ["a", "b"],
                },
                {
                    "_type": "move_shapes",
                    "shapeIds": ["c"],
                    "dx": 3,
                    "dy": 4.5,
                },
            ],
        }
    )
    out = reas._parse_dual_response(raw)  # type: ignore[attr-defined]
    actions = out.get("canvasActions")
    assert isinstance(actions, list) and len(actions) == 3
    assert actions[0] == {
        "_type": "create_text",
        "x": 1.5,
        "y": 2.0,
        "text": "Label",
    }


def test_parse_dual_response_drops_malformed_canvas_action() -> None:
    raw = json.dumps(
        {
            "my_response": "a",
            "what_i_see": "b",
            "canvasActions": [
                {"_type": "create_text", "x": 0, "y": 0, "text": "ok"},
                {"_type": "create_text", "x": "nope", "y": 0, "text": "bad"},
            ],
        }
    )
    out = reas._parse_dual_response(raw)  # type: ignore[attr-defined]
    assert len(out.get("canvasActions") or []) == 1


def test_parse_dual_response_accepts_geo_arrow_draw_actions() -> None:
    raw = json.dumps(
        {
            "my_response": "ok",
            "what_i_see": "see",
            "canvasActions": [
                {
                    "_type": "create_geo",
                    "geo": "rectangle",
                    "x": 10,
                    "y": 20,
                    "w": 160,
                    "h": 80,
                    "text": "Server",
                    "color": "blue",
                },
                {
                    "_type": "create_arrow",
                    "x1": 170,
                    "y1": 60,
                    "x2": 300,
                    "y2": 60,
                    "text": "request",
                },
                {
                    "_type": "create_draw",
                    "points": [{"x": 1, "y": 1}, {"x": 5, "y": 9}, {"x": 11, "y": 3}],
                    "color": "red",
                },
            ],
        }
    )
    out = reas._parse_dual_response(raw)  # type: ignore[attr-defined]
    actions = out.get("canvasActions")
    assert isinstance(actions, list) and len(actions) == 3
    assert actions[0]["_type"] == "create_geo"
    assert actions[0]["geo"] == "rectangle"
    assert actions[0]["text"] == "Server"
    assert actions[0]["color"] == "blue"
    assert actions[1]["_type"] == "create_arrow"
    assert actions[1]["x1"] == 170.0 and actions[1]["y2"] == 60.0
    assert actions[2]["_type"] == "create_draw"
    assert len(actions[2]["points"]) == 3


def test_parse_dual_response_drops_invalid_geo_and_draw() -> None:
    raw = json.dumps(
        {
            "my_response": "ok",
            "what_i_see": "see",
            "canvasActions": [
                {"_type": "create_geo", "geo": "hexagon", "x": 0, "y": 0, "w": 10, "h": 10},
                {"_type": "create_geo", "geo": "rectangle", "x": 0, "y": 0, "w": -5, "h": 10},
                {"_type": "create_draw", "points": [{"x": 0, "y": 0}]},
                {"_type": "create_arrow", "x1": "no", "y1": 0, "x2": 1, "y2": 2},
            ],
        }
    )
    out = reas._parse_dual_response(raw)  # type: ignore[attr-defined]
    assert (out.get("canvasActions") or []) == []

"""Diagram intent heuristic and canvas context prompt formatting."""

from app.models.schemas import (
    CanvasContext,
    CanvasContextViews,
    CanvasViewBounds,
    SpatialPayload,
    VlmInferenceRequest,
)
from app.services import reasoner_agent
from app.services.reasoner import (
    build_answer_prompt_suffixes,
    format_canvas_context_for_prompt,
    wants_diagram_canvas_actions,
)


def _minimal_context() -> CanvasContext:
    return CanvasContext(
        pageShapeCount=2,
        views=CanvasContextViews(
            answerCrop=CanvasViewBounds(x=10, y=20, width=100, height=50),
            layoutViewport=CanvasViewBounds(x=0, y=0, width=800, height=600),
        ),
        selectionShapes=[],
        viewportShapes=[],
        peripheral=[],
    )


def test_wants_diagram_canvas_actions_positive() -> None:
    req = VlmInferenceRequest(
        imageBase64="x",
        spatial=SpatialPayload(x=0, y=0, width=1, height=1),
        queryText="default",
        userMessage="Explain web servers using diagrams",
    )
    assert wants_diagram_canvas_actions(req) is True


def test_wants_diagram_canvas_actions_from_query_text() -> None:
    req = VlmInferenceRequest(
        imageBase64="x",
        spatial=SpatialPayload(x=0, y=0, width=1, height=1),
        queryText="Show a flowchart of the request lifecycle",
    )
    assert wants_diagram_canvas_actions(req) is True


def test_wants_diagram_canvas_actions_negative() -> None:
    req = VlmInferenceRequest(
        imageBase64="x",
        spatial=SpatialPayload(x=0, y=0, width=1, height=1),
        queryText="What is a variable?",
    )
    assert wants_diagram_canvas_actions(req) is False


def test_build_answer_prompt_suffixes_includes_diagram_hint() -> None:
    req = VlmInferenceRequest(
        imageBase64="x",
        spatial=SpatialPayload(x=0, y=0, width=1, height=1),
        queryText="INSTR",
        userMessage="sketch the architecture",
    )
    s = build_answer_prompt_suffixes(req, include_diagram_hint=True)
    assert "[Diagram intent]" in s
    assert "canvasActions" in s


def test_build_answer_prompt_suffixes_spatial_pass_skips_diagram_hint() -> None:
    req = VlmInferenceRequest(
        imageBase64="x",
        spatial=SpatialPayload(x=0, y=0, width=1, height=1),
        queryText="INSTR",
        userMessage="draw a diagram of everything",
        canvasContext=_minimal_context(),
    )
    s = build_answer_prompt_suffixes(req, include_diagram_hint=False)
    assert "[Diagram intent]" not in s
    assert "[Canvas context" in s


def test_format_canvas_context_empty() -> None:
    assert format_canvas_context_for_prompt(None) == ""


def test_format_canvas_context_includes_json() -> None:
    cc = _minimal_context()
    out = format_canvas_context_for_prompt(cc)
    assert "[Canvas context" in out
    assert '"version":1' in out
    assert "layoutViewport" in out


def test_reasoner_agent_module_mentions_canvas_actions_contract() -> None:
    with open(reasoner_agent.__file__, encoding="utf-8") as f:
        body = f.read()
    assert "canvasActions" in body
    assert "queryText" in body

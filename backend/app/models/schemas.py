"""Pydantic models mirroring TypeScript VlmInferenceRequest and SpatialPayload contracts."""

from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class SpatialPayload(BaseModel):
    """Bounding box geometry passed from frontend and echoed in responses."""

    model_config = ConfigDict(extra="forbid")

    x: float
    y: float
    width: float
    height: float


class ConversationTurn(BaseModel):
    """One prior completed generate turn (camelCase to match client JSON)."""

    model_config = ConfigDict(extra="forbid")

    at: str
    whatISee: str
    myResponse: str
    selectionRef: Optional[SpatialPayload] = None


class CanvasViewBounds(BaseModel):
    model_config = ConfigDict(extra="forbid")

    x: float
    y: float
    width: float
    height: float


class CanvasContextViews(BaseModel):
    model_config = ConfigDict(extra="forbid")

    answerCrop: Optional[CanvasViewBounds] = None
    layoutViewport: CanvasViewBounds


class SimplifiedShapeRef(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    type: str
    x: float
    y: float
    width: float
    height: float
    text: Optional[str] = None


class PeripheralCluster(BaseModel):
    model_config = ConfigDict(extra="forbid")

    x: float
    y: float
    width: float
    height: float
    count: int


class CanvasContext(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: Literal[1] = 1
    pageShapeCount: int
    views: CanvasContextViews
    selectionShapes: list[SimplifiedShapeRef] = Field(default_factory=list)
    viewportShapes: list[SimplifiedShapeRef] = Field(default_factory=list)
    viewportShapeTotal: Optional[int] = None
    peripheral: list[PeripheralCluster] = Field(default_factory=list)


class VlmInferenceRequest(BaseModel):
    """Reasoning input payload for POST /api/v1/reason."""

    model_config = ConfigDict(extra="forbid")

    imageBase64: str
    spatialContextImageBase64: Optional[str] = None
    canvasContext: Optional[CanvasContext] = None
    spatial: SpatialPayload
    queryText: str
    conversationContext: Optional[list[ConversationTurn]] = None
    userMessage: Optional[str] = None
    placementContext: Optional["PlacementContext"] = None
    # When omitted or null, all registered agent tools are offered. When present
    # (including []), only listed names are registered with the model for this request.
    enabledAgentTools: Optional[list[str]] = None


class TokenUsage(BaseModel):
    """OpenAI usage.* (prompt/completion/total tokens) for telemetry."""

    model_config = ConfigDict(extra="forbid")

    prompt_tokens: Optional[int] = None
    completion_tokens: Optional[int] = None
    total_tokens: Optional[int] = None


class ReasoningTimings(BaseModel):
    """Per-stage server-side timings in milliseconds."""

    model_config = ConfigDict(extra="forbid")

    provider: str
    inference_ms: float
    parse_ms: float
    total_ms: float


class SpatialDebugInfo(BaseModel):
    """Diagnostic view of the spatial reasoning pass for the telemetry panel."""

    model_config = ConfigDict(extra="forbid")

    pass_ran: bool
    raw_output: Optional[str] = None
    parsed: Optional[dict] = None


class ToolTraceItem(BaseModel):
    """One executed tool in the stream/agent path."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    name: str
    args: str = ""
    ms: float = 0.0
    ok: bool = True
    out_bytes: int = Field(0, alias="bytes", serialization_alias="bytes")


class ResponseStageItem(BaseModel):
    """A UI stage (reading canvas, tool_call, finalizing, …)."""

    model_config = ConfigDict(extra="forbid")

    name: str
    t_ms: float
    detail: Optional[dict[str, Any]] = None


class VlmInferenceResponse(BaseModel):
    """Reasoning output with lifecycle metadata for debug panel conversation flow."""

    model_config = ConfigDict(extra="forbid")

    my_response: str
    what_i_see: str
    spatial: SpatialPayload
    status: str
    started_at: str
    finished_at: str
    timings: ReasoningTimings
    tool_trace: Optional[list[ToolTraceItem]] = None
    stages: Optional[list[ResponseStageItem]] = None
    mode: Optional[Literal["answer", "coding"]] = None
    # Raw layout hint from the VLM; validated/normalized client-side.
    layoutStyle: Optional[str] = None
    # ISO 639-1 language code (or "unknown") reported by the VLM.
    detected_language: Optional[str] = None
    detected_script: Optional[str] = None
    script_direction: Optional[str] = None
    intent_hint: Optional[str] = None
    preferred_side: Optional[str] = None
    placement_mode: Optional[str] = None
    target_column_index: Optional[int] = None
    spatial_confidence: Optional[float] = None
    debug_spatial: Optional[SpatialDebugInfo] = None
    # List of { "_type": "create_text" | "delete_shapes" | "move_shapes", ... }.
    # Kept as dicts so wire JSON can use _type; validated in app.services.reasoner.
    canvasActions: Optional[list[dict[str, Any]]] = None
    # Populated when the provider returns usage (summed across parallel passes).
    usage: Optional[TokenUsage] = None
    usage_rounds: Optional[list[TokenUsage]] = None
    usage_total: Optional[TokenUsage] = None


class HybridWidthProfile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    w_avg: float
    min_width: float
    max_width: float
    sample_count: int


class HybridLayoutAnalysis(BaseModel):
    model_config = ConfigDict(extra="forbid")

    layout_style: str
    intent_hint: str
    script_direction: str
    detected_language: str
    detected_script: str
    language_confidence: float
    divider_intent: bool
    split_column_context: bool
    width_profile: HybridWidthProfile


class HybridScoreBreakdown(BaseModel):
    model_config = ConfigDict(extra="forbid")

    side_bias: float
    aspect_match: float
    clearance: float
    reading_continuity: float


class HybridPlacementDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")

    side: str
    clearance_ok: bool
    overlap_count: int
    fusion_score: float
    score_breakdown: HybridScoreBreakdown


class HybridContinuationDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")

    overflow_detected: bool
    continuation_mode: str
    reading_order: str
    from_column_index: Optional[int] = None
    to_column_index: Optional[int] = None
    trigger_reason: Optional[str] = None


class HybridLanguageDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")

    selection_mode: str
    selected_language: str
    selection_source: str
    fallback_applied: bool
    user_hint_shown: bool
    selected_script: Optional[str] = None
    confidence: Optional[float] = None
    fallback_reason: Optional[str] = None


class PlacementContextWidthProfile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    w_avg: float
    min_width: float
    max_width: float
    sample_count: int


class PlacementContext(BaseModel):
    model_config = ConfigDict(extra="forbid")

    divider_intent: Optional[bool] = None
    split_column_context: Optional[bool] = None
    script_direction: Optional[str] = None
    width_profile: Optional[PlacementContextWidthProfile] = None


VlmInferenceRequest.model_rebuild()

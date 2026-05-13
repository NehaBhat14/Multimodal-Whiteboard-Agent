"""Hybrid telemetry schema model fixture tests."""

from app.models.schemas import (
    HybridContinuationDecision,
    HybridLanguageDecision,
    HybridLayoutAnalysis,
    HybridPlacementDecision,
    HybridScoreBreakdown,
    HybridWidthProfile,
)


def test_hybrid_layout_analysis_model_accepts_expected_payload() -> None:
    profile = HybridWidthProfile(w_avg=280.0, min_width=220.0, max_width=340.0, sample_count=5)
    analysis = HybridLayoutAnalysis(
        layout_style="COLUMNAR",
        intent_hint="comparison",
        script_direction="LTR",
        detected_language="en",
        detected_script="Latin",
        language_confidence=0.91,
        divider_intent=True,
        split_column_context=True,
        width_profile=profile,
    )
    assert analysis.layout_style == "COLUMNAR"
    assert analysis.width_profile.sample_count == 5


def test_hybrid_run_decision_models_support_telemetry_shapes() -> None:
    score = HybridScoreBreakdown(
        side_bias=0.6,
        aspect_match=0.3,
        clearance=0.8,
        reading_continuity=0.7,
    )
    placement = HybridPlacementDecision(
        side="below",
        clearance_ok=True,
        overlap_count=0,
        fusion_score=2.4,
        score_breakdown=score,
    )
    continuation = HybridContinuationDecision(
        overflow_detected=True,
        continuation_mode="next_column_top",
        reading_order="LTR",
        from_column_index=0,
        to_column_index=1,
        trigger_reason="line_break_overflow",
    )
    language = HybridLanguageDecision(
        selection_mode="auto",
        selected_language="en",
        selection_source="detected",
        fallback_applied=False,
        user_hint_shown=False,
        confidence=0.91,
    )
    assert placement.side == "below"
    assert continuation.to_column_index == 1
    assert language.selection_mode == "auto"

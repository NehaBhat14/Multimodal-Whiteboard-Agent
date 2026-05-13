"""Contract checks for hybrid layout intelligence schema additions."""

import json
from pathlib import Path


def test_hybrid_contract_schema_has_required_sections() -> None:
    root = Path(__file__).resolve().parents[2]
    schema_path = (
        root
        / "specs"
        / "008-hybrid-layout-intelligence"
        / "contracts"
        / "hybrid-layout-intelligence.schema.json"
    )
    assert schema_path.exists(), "Hybrid schema contract file is missing"

    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    props = schema.get("properties", {})

    for key in ("analysis", "placement", "continuation", "language_decision"):
        assert key in props, f"Missing `{key}` contract section"

    analysis_required = props["analysis"].get("required", [])
    assert "layout_style" in analysis_required
    assert "split_column_context" in analysis_required

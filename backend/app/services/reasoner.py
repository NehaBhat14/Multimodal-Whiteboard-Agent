"""Reasoning service with optional OpenAI-backed inference."""

from __future__ import annotations

import json
import os
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Optional
from urllib import error, request

from app.models.schemas import CanvasContext, ConversationTurn, VlmInferenceRequest


class ReasoningProviderError(Exception):
    """Raised when the configured provider fails to produce output."""


PARSE_ERROR_WHAT_I_SEE = "[Model output was not valid JSON]"


def normalize_openai_usage(raw: Any) -> Optional[dict[str, int]]:
    """Map Responses / Chat Completions usage dict to prompt/completion/total ints."""
    if not isinstance(raw, dict):
        return None
    pt = raw.get("prompt_tokens")
    if pt is None:
        pt = raw.get("input_tokens")
    ct = raw.get("completion_tokens")
    if ct is None:
        ct = raw.get("output_tokens")
    tt = raw.get("total_tokens")
    try:
        pt_i = int(pt) if pt is not None else 0
        ct_i = int(ct) if ct is not None else 0
        tt_i = int(tt) if tt is not None else 0
    except (TypeError, ValueError):
        return None
    if pt_i == 0 and ct_i == 0 and tt_i == 0:
        return None
    if tt_i == 0:
        tt_i = pt_i + ct_i
    return {"prompt_tokens": pt_i, "completion_tokens": ct_i, "total_tokens": tt_i}


def sum_usage_rounds(rounds: list[dict[str, int]]) -> dict[str, int]:
    pt = sum(r.get("prompt_tokens", 0) for r in rounds)
    ct = sum(r.get("completion_tokens", 0) for r in rounds)
    tt = sum(r.get("total_tokens", 0) for r in rounds)
    if tt == 0:
        tt = pt + ct
    return {"prompt_tokens": pt, "completion_tokens": ct, "total_tokens": tt}


def _provider() -> str:
    configured = os.getenv("REASONING_PROVIDER")
    if configured:
        return configured.strip().lower()
    return "openai" if os.getenv("OPENAI_API_KEY") else "mock"


def _to_data_url(image_base64: str) -> str:
    candidate = image_base64.strip()
    if not candidate:
        return ""
    if candidate.startswith("data:"):
        return candidate
    return f"data:image/png;base64,{candidate}"


def _extract_output_text(payload: dict[str, Any]) -> str:
    output_text = payload.get("output_text")
    if isinstance(output_text, str) and output_text.strip():
        return output_text.strip()

    output = payload.get("output")
    if isinstance(output, list):
        for item in output:
            if not isinstance(item, dict):
                continue
            contents = item.get("content")
            if not isinstance(contents, list):
                continue
            for content in contents:
                if not isinstance(content, dict):
                    continue
                text = content.get("text")
                if isinstance(text, str) and text.strip():
                    return text.strip()

    raise ReasoningProviderError("OpenAI response did not contain text output.")


def build_session_text_prefix(request_payload: VlmInferenceRequest) -> str:
    """Plain-text block for prior conversation + follow-up, answer pass only (see 009 research)."""
    parts: list[str] = []
    ctx: list[ConversationTurn] | None = request_payload.conversationContext
    if ctx:
        parts.append("[Conversation so far]\n")
        for i, t in enumerate(ctx, 1):
            parts.append(
                f"Turn {i} ({t.at}):\n"
                f"What the assistant saw: {t.whatISee}\n"
                f"Assistant reply: {t.myResponse}\n\n"
            )
    follow = (request_payload.userMessage or "").strip()
    if follow:
        parts.append(f"[User follow-up]\n{follow}\n\n")
    return "".join(parts)


# Align with frontend CANVAS_CONTEXT_BUDGET_BYTES (trim if JSON exceeds this).
_CANVAS_CONTEXT_PROMPT_BUDGET_BYTES = 300_000

_DIAGRAM_INTENT_HINT = (
    "[Diagram intent]\n"
    "The user asked for a visual or diagram-style explanation. Build the diagram via "
    'a non-empty "canvasActions" array — do NOT rely on prose or unicode art. Use:\n'
    "  - create_geo (rectangle/ellipse/diamond, with optional inner `text` label and "
    "`color`) for nodes; emit w/h roughly 140-220 wide and 60-100 tall unless a label "
    "is long.\n"
    "  - create_arrow (x1,y1 -> x2,y2, optional `text` label and `color`) to connect "
    "nodes; place endpoints at the adjacent edges of the two create_geo boxes so the "
    "arrow visually meets their borders (e.g. right-edge midpoint of box A to "
    "left-edge midpoint of box B).\n"
    "  - create_text for free-floating captions when needed; create_draw only for "
    "small freehand accents.\n"
    "Offset the whole diagram from the selection bounding box above (e.g. to the right "
    'or below). Keep "my_response" to one short summary line (still non-empty) so the '
    "usual answer rendering has text to place. The client will translate all canvas "
    "actions by a single (dx, dy) offset to avoid overlapping existing shapes — emit "
    "consistent relative coordinates so box corners and arrow endpoints stay aligned."
)

# Substrings matched against userMessage + queryText (lowercased).
_DIAGRAM_INTENT_NEEDLES: tuple[str, ...] = (
    "diagram",
    "flowchart",
    "flow chart",
    "using diagrams",
    "visualize",
    "visualise",
    "sketch",
    "mind map",
    "mindmap",
    "illustrate",
    "draw a",
    "drawing",
    "whiteboard diagram",
    "with a diagram",
    "as a diagram",
)


def wants_diagram_canvas_actions(request_payload: VlmInferenceRequest) -> bool:
    """Heuristic: user likely wants shapes via canvasActions (e.g. labeled diagram)."""
    blob = f"{request_payload.userMessage or ''}\n{request_payload.queryText or ''}".lower()
    return any(n in blob for n in _DIAGRAM_INTENT_NEEDLES)


def format_canvas_context_for_prompt(canvas_context: CanvasContext | None) -> str:
    """Serialize canvasContext for the model; cap UTF-8 size by trimming lists."""
    if canvas_context is None:
        return ""
    data: dict[str, Any] = canvas_context.model_dump(mode="json")
    prefix = (
        "[Canvas context — simplified shapes and views in page coordinates; "
        "avoid overlapping viewportShapes when placing new text; anchor new nodes "
        "relative to the selection bounding box above. JSON follows]\n"
    )

    def encoded_len(obj: dict[str, Any]) -> int:
        return len(json.dumps(obj, separators=(",", ":")).encode("utf-8"))

    while encoded_len(data) + len(prefix.encode("utf-8")) > _CANVAS_CONTEXT_PROMPT_BUDGET_BYTES:
        vs = data.get("viewportShapes")
        if isinstance(vs, list) and len(vs) > 1:
            data["viewportShapes"] = vs[: max(1, len(vs) // 2)]
            continue
        per = data.get("peripheral")
        if isinstance(per, list) and len(per) > 0:
            data["peripheral"] = per[: max(0, len(per) // 2)]
            continue
        sel = data.get("selectionShapes")
        if isinstance(sel, list) and len(sel) > 1:
            data["selectionShapes"] = sel[:1]
            continue
        if isinstance(vs, list) and len(vs) == 1:
            data["viewportShapes"] = []
            continue
        break

    body = json.dumps(data, separators=(",", ":"))
    full = prefix + body
    cap = _CANVAS_CONTEXT_PROMPT_BUDGET_BYTES
    encoded = full.encode("utf-8")
    if len(encoded) > cap:
        full = encoded[:cap].decode("utf-8", errors="ignore")
    return full


def build_answer_prompt_suffixes(
    request_payload: VlmInferenceRequest, *, include_diagram_hint: bool
) -> str:
    """Extra user-text blocks for the answer pass (and diagram hint when requested)."""
    parts: list[str] = []
    cc = format_canvas_context_for_prompt(request_payload.canvasContext)
    if cc:
        parts.append(cc)
    if include_diagram_hint and wants_diagram_canvas_actions(request_payload):
        parts.append(_DIAGRAM_INTENT_HINT)
    return "\n\n".join(parts)


def _openai_reasoning_text(
    request_payload: VlmInferenceRequest,
    *,
    query_text_override: str | None = None,
    image_base64_override: str | None = None,
) -> tuple[str, Optional[dict[str, int]]]:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise ReasoningProviderError("OPENAI_API_KEY is required for OpenAI inference.")

    model = os.getenv("OPENAI_MODEL", "gpt-4o").strip() or "gpt-4o"
    timeout_seconds = float(os.getenv("OPENAI_TIMEOUT_SECONDS", "60"))

    spatial_json = request_payload.spatial.model_dump_json()
    base_query = (query_text_override or request_payload.queryText).strip()
    if query_text_override is None:
        session_prefix = build_session_text_prefix(request_payload)
    else:
        # Spatial (placement-only) pass: do not include conversation (009 research).
        session_prefix = ""
    core_text = (
        f"{session_prefix}{base_query}\n\n"
        f"[Spatial context — bounding box in page coordinates (x, y, width, height): {spatial_json}]"
    )
    suffix = build_answer_prompt_suffixes(
        request_payload,
        include_diagram_hint=query_text_override is None,
    )
    if suffix:
        core_text = f"{core_text}\n\n{suffix}"

    content: list[dict[str, str]] = [
        {
            "type": "input_text",
            "text": core_text,
        }
    ]

    image_data_url = _to_data_url(
        image_base64_override
        if image_base64_override is not None
        else request_payload.imageBase64
    )
    if image_data_url:
        content.append({"type": "input_image", "image_url": image_data_url})

    body: dict[str, Any] = {
        "model": model,
        "input": [
            {
                "role": "user",
                "content": content,
            }
        ],
        "text": {"format": {"type": "json_object"}},
    }

    req = request.Request(
        "https://api.openai.com/v1/responses",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with request.urlopen(req, timeout=timeout_seconds) as resp:
            decoded = json.loads(resp.read().decode("utf-8"))
    except error.HTTPError as exc:
        body_text = exc.read().decode("utf-8", errors="replace")
        raise ReasoningProviderError(
            f"OpenAI HTTP error {exc.code}: {body_text}"
        ) from exc
    except error.URLError as exc:
        raise ReasoningProviderError(f"OpenAI network error: {exc.reason}") from exc
    except TimeoutError as exc:
        raise ReasoningProviderError("OpenAI request timed out.") from exc
    except json.JSONDecodeError as exc:
        raise ReasoningProviderError("OpenAI returned invalid JSON.") from exc

    text = _extract_output_text(decoded)
    usage = normalize_openai_usage(decoded.get("usage"))
    return text, usage


def _build_spatial_only_query_text(request_payload: VlmInferenceRequest) -> str:
    placement_context = (
        request_payload.placementContext.model_dump_json()
        if request_payload.placementContext is not None
        else "null"
    )
    spatial_json = request_payload.spatial.model_dump_json()
    return (
        "You are a spatial layout planner for a digital whiteboard. The attached "
        "image shows the FULL canvas (not a crop). A user has selected one "
        "region and will receive a machine-written answer rendered somewhere "
        "on the canvas. Your job is to decide WHERE that answer should go.\n\n"
        "Return EXACTLY one JSON object (no markdown, no commentary, no code "
        "fences) with ALL of these keys populated: my_response, what_i_see, "
        "layoutStyle, detected_language, detected_script, script_direction, "
        "intent_hint, preferred_side, placement_mode, target_column_index, "
        "spatial_confidence.\n\n"
        "Field rules:\n"
        '- my_response MUST be the empty string "".\n'
        "- what_i_see: 1-3 sentences describing the global layout — number of "
        "lanes/columns, dividers, existing Q&A pairs, and where the selection "
        "sits within that structure.\n"
        '- layoutStyle: one of "COLUMNAR", "MIND_MAP", "RESEARCH_STACK", '
        '"FLOWING". Never "UNKNOWN" — pick the closest match.\n'
        "- detected_language: ISO 639-1 code (e.g. \"en\", \"hi\"). Never "
        '"unknown" — pick the dominant script if mixed.\n'
        '- detected_script: e.g. "Latin", "Devanagari", "Han".\n'
        '- script_direction: one of "LTR", "RTL", "VERTICAL". Never "UNKNOWN".\n'
        '- intent_hint: one of "comparison", "brainstorm", "notes", "timeline". '
        'Never "unknown" — pick the closest match.\n'
        '- preferred_side: one of "below", "right", "left", "above". NEVER '
        '"unknown" and NEVER null. This is where the answer should appear '
        "RELATIVE TO THE SELECTION bounding box.\n"
        '- placement_mode: one of "same_lane" or "cross_divider". NEVER '
        '"unknown" and NEVER null. "same_lane" = answer stays in the same '
        'column/region as the selection. "cross_divider" = answer crosses a '
        "visible divider into another region.\n"
        "- target_column_index: 0-based integer for the chosen column. Use 0 "
        "if the layout is single-lane.\n"
        "- spatial_confidence: number in [0, 1]. NEVER null.\n\n"
        "Placement decision policy (apply in order — FIRST matching rule wins):\n"
        "1. USER-DRAWN INTENT (highest priority): if the canvas shows any "
        "hand-drawn placement instruction aimed at a region other than "
        "directly-below-selection, follow it. Examples:\n"
        "   - An arrow that originates near the selection and points into a "
        "different region.\n"
        "   - A label such as 'answer here', 'response →', 'put text here', "
        "'text should be here', often written in a distinct color (red, blue), "
        "and an empty region near that label.\n"
        "   - A circled or boxed empty region labeled as a response area.\n"
        "   When this fires: placement_mode='cross_divider' if a divider is "
        "between selection and target region, otherwise 'same_lane'. "
        "preferred_side = direction of that region from the selection "
        "('right', 'left', 'above', 'below'). spatial_confidence >= 0.85.\n"
        "2. CROWDED-LANE OVERFLOW: if the selection sits inside a multi-column "
        "layout separated by a visible divider AND the selection's own column "
        "is visibly full (2+ existing Q&A pairs or large dense content above, "
        "and little vertical room left under the selection) AND the adjacent "
        "column on the other side of the divider is visibly empty or very "
        "sparse, then the answer should cross into the empty adjacent column: "
        "placement_mode='cross_divider', preferred_side='right' or 'left' "
        "(whichever side has the empty column), spatial_confidence >= 0.75. "
        "This is standard newspaper/research-column overflow behavior.\n"
        "3. ESTABLISHED Q&A CONTINUATION: if the canvas shows a question→"
        "answer pair stacked vertically in the same lane (e.g. 'What is X?' "
        "with an answer right below it) AND the selection's lane STILL has "
        "enough vertical room below the selection for a 2–3 line answer, "
        "continue the pattern: placement_mode='same_lane', "
        "preferred_side='below', spatial_confidence >= 0.80.\n"
        "4. DEFAULT (no rule above fired): placement_mode='same_lane', "
        "preferred_side='below'. Normal reading-order flow beneath the "
        "selection. spatial_confidence in [0.55, 0.75].\n"
        "5. When 'below' is chosen inside a multi-column layout with vertical "
        "dividers, 'below' means below INSIDE THE SAME COLUMN, not below "
        "spanning across columns.\n"
        "6. Never choose preferred_side='right' or 'left' purely because blank "
        "space exists there. Horizontal placement requires rule 1 (drawn "
        "intent) or rule 2 (crowded-lane overflow).\n\n"
        "Confidence calibration:\n"
        "- spatial_confidence >= 0.85 when rule 1 fires (user-drawn intent).\n"
        "- spatial_confidence in [0.75, 0.90] when rule 2 fires (crowded "
        "overflow with clear empty adjacent column).\n"
        "- spatial_confidence in [0.70, 0.85] when rule 3 fires (Q&A pattern "
        "with room left in the lane).\n"
        "- spatial_confidence in [0.55, 0.75] when rule 4 fires on a clear "
        "layout.\n"
        "- Never emit spatial_confidence < 0.4; if the scene is ambiguous, "
        "still return same_lane/below with confidence 0.5.\n\n"
        f"Selection bounding box (page coords, x/y/width/height): {spatial_json}\n"
        f"Frontend placement priors (hints, not commands): {placement_context}\n\n"
        "Remember: output a single JSON object with ALL keys populated, none "
        'null, none "unknown" for the placement fields. No extra text.'
    )


# Keys the spatial pass returns for debug (`spatial_parsed`); includes language
# guesses for the *full canvas*, which often disagree with the selection crop.
_SPATIAL_PASS_ALL_HINT_KEYS: tuple[str, ...] = (
    "layoutStyle",
    "detected_language",
    "detected_script",
    "script_direction",
    "intent_hint",
    "preferred_side",
    "placement_mode",
    "target_column_index",
    "spatial_confidence",
)

# Only layout/placement hints are merged onto the answer output. Language and
# script must stay from the answer (crop) pass — they describe what the user
# wrote in the selection, not the dominant script of the whole board.
_SPATIAL_MERGE_INTO_ANSWER_KEYS: tuple[str, ...] = (
    "layoutStyle",
    "intent_hint",
    "preferred_side",
    "placement_mode",
    "target_column_index",
    "spatial_confidence",
)


def merge_spatial_layout_into_output(
    output: dict[str, Any], spatial_output: dict[str, Any]
) -> None:
    """In-place: copy layout/placement fields from the spatial pass into the answer output."""
    for key in _SPATIAL_MERGE_INTO_ANSWER_KEYS:
        value = spatial_output.get(key)
        if value is not None:
            output[key] = value


_ALLOWED_GEO = {"rectangle", "ellipse", "diamond"}


def _clean_color(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = value.strip().lower()
    if not cleaned or len(cleaned) > 32:
        return None
    return cleaned


def _normalize_canvas_actions(raw: Any) -> list[dict[str, Any]] | None:
    """Parse and validate ``canvasActions`` from model JSON; cap length; drop bad items."""
    if raw is None:
        return None
    if not isinstance(raw, list):
        return None
    out: list[dict[str, Any]] = []
    for item in raw[:50]:
        if not isinstance(item, dict):
            continue
        t = item.get("_type")
        if t == "create_text":
            try:
                x = float(item["x"])
                y = float(item["y"])
            except (KeyError, TypeError, ValueError):
                continue
            text = str(item.get("text", ""))
            if not text.strip():
                continue
            out.append(
                {
                    "_type": "create_text",
                    "x": x,
                    "y": y,
                    "text": text[:10_000],
                }
            )
        elif t == "create_geo":
            geo = item.get("geo")
            if not isinstance(geo, str) or geo not in _ALLOWED_GEO:
                continue
            try:
                x = float(item["x"])
                y = float(item["y"])
                w = float(item["w"])
                h = float(item["h"])
            except (KeyError, TypeError, ValueError):
                continue
            if not (0 < w <= 5_000) or not (0 < h <= 5_000):
                continue
            entry: dict[str, Any] = {
                "_type": "create_geo",
                "geo": geo,
                "x": x,
                "y": y,
                "w": w,
                "h": h,
            }
            text_raw = item.get("text")
            if isinstance(text_raw, str) and text_raw:
                entry["text"] = text_raw[:2_000]
            color = _clean_color(item.get("color"))
            if color:
                entry["color"] = color
            out.append(entry)
        elif t == "create_arrow":
            try:
                x1 = float(item["x1"])
                y1 = float(item["y1"])
                x2 = float(item["x2"])
                y2 = float(item["y2"])
            except (KeyError, TypeError, ValueError):
                continue
            entry = {
                "_type": "create_arrow",
                "x1": x1,
                "y1": y1,
                "x2": x2,
                "y2": y2,
            }
            text_raw = item.get("text")
            if isinstance(text_raw, str) and text_raw:
                entry["text"] = text_raw[:2_000]
            color = _clean_color(item.get("color"))
            if color:
                entry["color"] = color
            out.append(entry)
        elif t == "create_draw":
            points_raw = item.get("points")
            if not isinstance(points_raw, list) or not (2 <= len(points_raw) <= 500):
                continue
            points: list[dict[str, float]] = []
            bad = False
            for p in points_raw:
                if not isinstance(p, dict):
                    bad = True
                    break
                try:
                    px = float(p["x"])
                    py = float(p["y"])
                except (KeyError, TypeError, ValueError):
                    bad = True
                    break
                points.append({"x": px, "y": py})
            if bad or len(points) < 2:
                continue
            entry = {"_type": "create_draw", "points": points}
            color = _clean_color(item.get("color"))
            if color:
                entry["color"] = color
            out.append(entry)
        elif t == "delete_shapes":
            ids = item.get("shapeIds")
            if not isinstance(ids, list):
                continue
            clean: list[str] = []
            for x in ids[:500]:
                if isinstance(x, str):
                    clean.append(x)
                elif isinstance(x, (int, float)):
                    clean.append(str(x))
            if not clean:
                continue
            out.append({"_type": "delete_shapes", "shapeIds": clean})
        elif t == "move_shapes":
            ids = item.get("shapeIds")
            if not isinstance(ids, list):
                continue
            clean = [
                str(x) if not isinstance(x, str) else x
                for x in ids[:500]
                if isinstance(x, (str, int, float))
            ]
            if not clean:
                continue
            try:
                dx = float(item["dx"])
                dy = float(item["dy"])
            except (KeyError, TypeError, ValueError):
                continue
            out.append({"_type": "move_shapes", "shapeIds": clean, "dx": dx, "dy": dy})
    return out or None


def _parse_dual_response(raw_output_text: str) -> dict[str, Any]:
    """Parse ``{my_response, what_i_see, layoutStyle?, detected_language?, ...}``.

    Malformed JSON → ``my_response=raw, what_i_see=marker, hints=None``. Missing
    hint fields are silently dropped. Never raises.
    """
    trimmed = (raw_output_text or "").strip()
    try:
        # Strip code fences if the model wrapped output in ```...```.
        if trimmed.startswith("```"):
            trimmed = trimmed.strip("`").strip()

        start = trimmed.find("{")
        end = trimmed.rfind("}")
        candidate = trimmed
        if start != -1 and end != -1 and end > start:
            candidate = trimmed[start : end + 1]

        parsed = json.loads(candidate)
        if not isinstance(parsed, dict):
            raise ValueError("Expected JSON object")

        my_response = parsed.get("my_response", "")
        what_i_see = parsed.get("what_i_see", "")
        if not isinstance(my_response, str) or not isinstance(what_i_see, str):
            raise ValueError("Expected string fields")

        layout_style_raw = parsed.get("layoutStyle")
        layout_style = layout_style_raw if isinstance(layout_style_raw, str) else None

        detected_lang_raw = parsed.get("detected_language")
        detected_language = (
            detected_lang_raw if isinstance(detected_lang_raw, str) else None
        )
        detected_script_raw = parsed.get("detected_script")
        detected_script = (
            detected_script_raw if isinstance(detected_script_raw, str) else None
        )
        script_direction_raw = parsed.get("script_direction")
        script_direction = (
            script_direction_raw if isinstance(script_direction_raw, str) else None
        )
        intent_hint_raw = parsed.get("intent_hint")
        intent_hint = intent_hint_raw if isinstance(intent_hint_raw, str) else None
        preferred_side_raw = parsed.get("preferred_side")
        preferred_side = (
            preferred_side_raw if isinstance(preferred_side_raw, str) else None
        )
        placement_mode_raw = parsed.get("placement_mode")
        placement_mode = (
            placement_mode_raw if isinstance(placement_mode_raw, str) else None
        )
        target_column_raw = parsed.get("target_column_index")
        target_column_index = (
            target_column_raw if isinstance(target_column_raw, int) else None
        )
        spatial_confidence_raw = parsed.get("spatial_confidence")
        spatial_confidence = (
            float(spatial_confidence_raw)
            if isinstance(spatial_confidence_raw, (int, float))
            else None
        )
        if spatial_confidence is not None and (
            spatial_confidence < 0 or spatial_confidence > 1
        ):
            spatial_confidence = None

        return {
            "my_response": my_response,
            "what_i_see": what_i_see,
            "layoutStyle": layout_style,
            "detected_language": detected_language,
            "detected_script": detected_script,
            "script_direction": script_direction,
            "intent_hint": intent_hint,
            "preferred_side": preferred_side,
            "placement_mode": placement_mode,
            "target_column_index": target_column_index,
            "spatial_confidence": spatial_confidence,
            "canvasActions": _normalize_canvas_actions(parsed.get("canvasActions")),
        }
    except Exception:
        return {
            "my_response": trimmed,
            "what_i_see": PARSE_ERROR_WHAT_I_SEE,
            "layoutStyle": None,
            "detected_language": None,
            "detected_script": None,
            "script_direction": None,
            "intent_hint": None,
            "preferred_side": None,
            "placement_mode": None,
            "target_column_index": None,
            "spatial_confidence": None,
            "canvasActions": None,
        }


def generate_reasoning_text(
    request_payload: VlmInferenceRequest,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Return ``(output, timings)``. Timings: provider, inference_ms, parse_ms."""
    provider = _provider()
    if provider == "openai":
        inf_start = time.perf_counter()
        answer_usage: Optional[dict[str, int]] = None
        spatial_usage: Optional[dict[str, int]] = None
        if request_payload.spatialContextImageBase64:
            with ThreadPoolExecutor(max_workers=2) as executor:
                answer_future = executor.submit(_openai_reasoning_text, request_payload)
                spatial_future = executor.submit(
                    _openai_reasoning_text,
                    request_payload,
                    query_text_override=_build_spatial_only_query_text(request_payload),
                    image_base64_override=request_payload.spatialContextImageBase64,
                )
                answer_raw, answer_usage = answer_future.result()
                spatial_raw, spatial_usage = spatial_future.result()
        else:
            answer_raw, answer_usage = _openai_reasoning_text(request_payload)
            spatial_raw = ""
        inference_ms = (time.perf_counter() - inf_start) * 1000.0

        parse_start = time.perf_counter()
        answer_output = _parse_dual_response(answer_raw)
        output = dict(answer_output)
        spatial_ran = bool(spatial_raw)
        spatial_parsed_keys: dict[str, Any] = {}
        if spatial_raw:
            spatial_output = _parse_dual_response(spatial_raw)
            print(
                "[reasoner] spatial raw (first 800 chars):",
                (spatial_raw or "")[:800].replace("\n", " "),
                flush=True,
            )
            print(
                "[reasoner] spatial parsed:",
                {
                    k: spatial_output.get(k)
                    for k in (
                        "layoutStyle",
                        "preferred_side",
                        "placement_mode",
                        "spatial_confidence",
                        "intent_hint",
                        "target_column_index",
                    )
                },
                flush=True,
            )
            for key in _SPATIAL_PASS_ALL_HINT_KEYS:
                spatial_parsed_keys[key] = spatial_output.get(key)
            merge_spatial_layout_into_output(output, spatial_output)
        parse_ms = (time.perf_counter() - parse_start) * 1000.0

        usage_rounds: list[dict[str, int]] = []
        if answer_usage:
            usage_rounds.append(answer_usage)
        if spatial_usage:
            usage_rounds.append(spatial_usage)
        usage_total: Optional[dict[str, int]] = (
            sum_usage_rounds(usage_rounds) if usage_rounds else None
        )

        return output, {
            "provider": "openai",
            "inference_ms": round(inference_ms, 3),
            "parse_ms": round(parse_ms, 3),
            "spatial_pass_ran": spatial_ran,
            "spatial_raw": spatial_raw or None,
            "spatial_parsed": spatial_parsed_keys or None,
            "usage_rounds": usage_rounds or None,
            "usage_total": usage_total,
        }

    # Deterministic mock output for offline tests.
    return (
        {
            "my_response": "mock my_response",
            "what_i_see": "mock what_i_see",
            "layoutStyle": None,
            "detected_language": None,
            "detected_script": None,
            "script_direction": None,
            "intent_hint": None,
            "preferred_side": None,
            "placement_mode": None,
            "target_column_index": None,
            "spatial_confidence": None,
            "canvasActions": None,
        },
        {
            "provider": "mock",
            "inference_ms": 0.0,
            "parse_ms": 0.0,
            "spatial_pass_ran": False,
            "spatial_raw": None,
            "spatial_parsed": None,
            "usage_rounds": None,
            "usage_total": None,
        },
    )

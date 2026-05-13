import type { SpatialPayload } from "./spatial";
import type { LayoutStyle } from "../lib/layout/placementContextTypes";

/** One completed reasoning turn, wire shape matches contracts/reasoning-session.schema.json */
export interface ConversationTurn {
  /** ISO-8601 timestamp (client) */
  at: string;
  whatISee: string;
  myResponse: string;
  /** Optional page-space selection for "continue with last selection" and fork UX */
  selectionRef?: SpatialPayload;
}

/**
 * Default OpenAI instruction for the ANSWER pass (sees the crop only).
 * Placement decisions live in a separate spatial pass — this prompt must not
 * emit `preferred_side` / `placement_mode` / `target_column_index` so those
 * fields come authoritatively from the spatial planner.
 */
export const DEFAULT_SELECTION_QUERY =
  "You are analyzing a cropped region from a digital whiteboard. The crop shows exactly what the user wrote or drew and wants answered.\n\n" +
  "Return EXACTLY one JSON object (no markdown, no commentary, no backticks) with these keys:\n" +
  "- \"my_response\": a concise, directly useful answer/critique/reply to what the user wrote or drew. Default: short enough for the whiteboard — ideally 1-3 sentences (about max ~240 characters) for normal Q&A. If you rely on web_search/fetch_url for news, security incidents, or other time-sensitive topics, you may run longer (about up to ~800 characters) to reflect what sources report, disambiguate names (e.g. product vs. model), and state uncertainty — stay focused, no filler. No meta-text (don't say \"Here is your answer:\"); no bullet-point markdown unless the user explicitly asked for a list.\n" +
  "- \"what_i_see\": 1-2 factual sentences describing the crop: a literal transcription of any text, the apparent intent (question, note, sketch, list), and any ambiguity. If the content is multilingual or not in English, include a short English restatement of the user's request.\n" +
  "- \"layoutStyle\": one of \"COLUMNAR\" (side-by-side columns visible in the crop), \"MIND_MAP\" (central idea with radial branches), \"RESEARCH_STACK\" (stacked notes or citations), \"FLOWING\" (free-form prose), or \"UNKNOWN\".\n" +
  "- \"detected_language\": ISO 639-1 code for the language the user wrote in (e.g. \"en\", \"hi\", \"fr\"), or \"unknown\".\n" +
  "- \"canvasActions\" (optional): omit, null, or an array of at most 50 structured canvas operations. When you need the app to create, move, or remove shapes (not just render handwriting), include actions here. Each action is an object with a \"_type\" field first. All coordinates are in tldraw page space. Allowed types:\n" +
  "    (1) `{ \"_type\": \"create_text\", \"x\": number, \"y\": number, \"text\": string }` — plain label shape.\n" +
  "    (2) `{ \"_type\": \"create_geo\", \"geo\": \"rectangle\"|\"ellipse\"|\"diamond\", \"x\": number, \"y\": number, \"w\": number, \"h\": number, \"text\"?: string, \"color\"?: string }` — a box/ellipse/diamond node for a flowchart. (x, y) is the top-left corner; w/h are page-space size. Include an optional inner label via `text`.\n" +
  "    (3) `{ \"_type\": \"create_arrow\", \"x1\": number, \"y1\": number, \"x2\": number, \"y2\": number, \"text\"?: string, \"color\"?: string }` — arrow from (x1,y1) to (x2,y2). Use these to connect create_geo nodes (point endpoints at the nodes' edge midpoints).\n" +
  "    (4) `{ \"_type\": \"create_draw\", \"points\": [{\"x\":number,\"y\":number}, ...], \"color\"?: string }` — freehand stroke (2-500 points).\n" +
  "    (5) `{ \"_type\": \"delete_shapes\", \"shapeIds\": string[] }` only ids you know exist.\n" +
  "    (6) `{ \"_type\": \"move_shapes\", \"shapeIds\": string[], \"dx\": number, \"dy\": number }` translate existing shapes.\n" +
  "  Supported `color` values: black, grey, red, light-red, orange, yellow, green, light-green, blue, light-blue, violet, light-violet. Unknown colors fall back to black.\n" +
  "  If you have nothing to do on the canvas, omit canvasActions or use an empty array. When the user asks for diagrams, flowcharts, or visual structure, do not rely on prose alone — build the diagram with a mix of create_geo (nodes), create_arrow (connectors), and optional create_text labels, anchored in page space and offset from the selection box (see canvas context when provided).\n\n" +
  "Hard rules:\n" +
  "- Output MUST be a single JSON object; no surrounding text, no code fences.\n" +
  "- my_response and what_i_see MUST be plain strings with no embedded JSON or markdown fences.\n" +
  "- Do NOT include placement fields (`preferred_side`, `placement_mode`, `target_column_index`, `spatial_confidence`) — a separate pass owns those. If you emit them they will be ignored.\n" +
  "- If the crop is blank or illegible, set my_response to a short clarification (\"The selection appears empty — please select the question you want answered.\") and what_i_see to a one-sentence description; use \"UNKNOWN\" / \"unknown\" for the hints.\n" +
  "- Never invent information that isn't supported by the crop; when unsure, say so briefly inside my_response.\n" +
  "- If you emit canvasActions for a diagram, keep \"my_response\" non-empty (e.g. one short summary line) in addition to the diagram shapes.\n" +
  "- The app may translate the whole canvasActions group by a single (dx, dy) to avoid overlapping the selection or other shapes. Emit coordinates with consistent relative positions (e.g. arrow endpoints meeting box edges); the group-level nudge keeps those relationships intact.";

/** Page-space AABB; matches `SpatialPayload` and wire JSON. */
export interface CanvasViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasContextViews {
  /** Selection bounds for the answer crop; null when no selection. */
  answerCrop: CanvasViewBounds | null;
  /** Current user viewport in page space (layout / spatial image). */
  layoutViewport: CanvasViewBounds;
}

export interface SimplifiedShapeRef {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
}

export interface PeripheralCluster {
  x: number;
  y: number;
  width: number;
  height: number;
  count: number;
}

export interface CanvasContext {
  version: 1;
  pageShapeCount: number;
  views: CanvasContextViews;
  selectionShapes: SimplifiedShapeRef[];
  viewportShapes: SimplifiedShapeRef[];
  /** When capped, how many in-view (non-selection) shapes existed. */
  viewportShapeTotal?: number;
  peripheral: PeripheralCluster[];
}

export type CanvasAction =
  | { _type: "create_text"; x: number; y: number; text: string }
  | {
      _type: "create_geo";
      geo: "rectangle" | "ellipse" | "diamond";
      x: number;
      y: number;
      w: number;
      h: number;
      text?: string;
      color?: string;
    }
  | {
      _type: "create_arrow";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      text?: string;
      color?: string;
    }
  | {
      _type: "create_draw";
      points: { x: number; y: number }[];
      color?: string;
    }
  | { _type: "delete_shapes"; shapeIds: string[] }
  | { _type: "move_shapes"; shapeIds: string[]; dx: number; dy: number };

export interface VlmInferenceRequest {
  imageBase64: string;
  /** Optional low-res full-canvas image for spatial-only reasoning pass. */
  spatialContextImageBase64?: string;
  /** Structured view of shapes and view bounds (optional; may be budget-trimmed). */
  canvasContext?: CanvasContext | null;
  spatial: SpatialPayload;
  queryText: string;
  /** Prior completed turns (oldest first), trimmed on the client before send. */
  conversationContext?: ConversationTurn[] | null;
  /** User follow-up line, separate from `queryText` system instructions. */
  userMessage?: string | null;
  /**
   * Agent tool names allowed for this request (OpenAI function names). Omit or
   * null to allow all server-registered tools; `[]` disables tools entirely.
   */
  enabledAgentTools?: string[] | null;
  placementContext?: {
    divider_intent?: boolean;
    split_column_context?: boolean;
    script_direction?: "LTR" | "RTL" | "VERTICAL" | "UNKNOWN";
    width_profile?: {
      w_avg: number;
      min_width: number;
      max_width: number;
      sample_count: number;
    };
  };
}

export interface ReasoningTimings {
  provider: string;
  inference_ms: number;
  parse_ms: number;
  total_ms: number;
}

/** OpenAI usage.* mirrored on the wire for telemetry / cost. */
export interface TokenUsage {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
}

export interface ToolTraceItem {
  name: string;
  args?: string;
  ms: number;
  ok: boolean;
  bytes: number;
}

export interface ResponseStageItem {
  name: string;
  t_ms: number;
  detail?: Record<string, unknown> | null;
}

export type ReasoningResponseMode = "answer" | "coding";

export interface VlmInferenceResponse {
  my_response: string;
  what_i_see: string;
  spatial: SpatialPayload;
  status: string;
  started_at: string;
  finished_at: string;
  timings: ReasoningTimings;
  tool_trace?: ToolTraceItem[] | null;
  stages?: ResponseStageItem[] | null;
  mode?: ReasoningResponseMode | null;
  /** Raw `layoutStyle` from the VLM; normalize via `parseLayoutStyle` before use. */
  layoutStyle?: LayoutStyle | string | null;
  /** ISO 639-1 code or "unknown" (telemetry + future Auto-mode disambiguation). */
  detected_language?: string | null;
  detected_script?: string | null;
  script_direction?: "LTR" | "RTL" | "VERTICAL" | "UNKNOWN" | null;
  intent_hint?: "comparison" | "brainstorm" | "notes" | "timeline" | "unknown" | null;
  preferred_side?: "right" | "left" | "below" | "above" | "unknown" | null;
  placement_mode?: "same_lane" | "cross_divider" | "unknown" | null;
  target_column_index?: number | null;
  spatial_confidence?: number | null;
  language_confidence?: number | null;
  /**
   * Diagnostic view of the spatial reasoning pass. Lets the telemetry panel
   * prove the spatial pass actually ran, and expose what the VLM literally
   * returned (or `null` / `"unknown"` fields it omitted).
   */
  debug_spatial?: {
    pass_ran: boolean;
    raw_output?: string | null;
    parsed?: Record<string, unknown> | null;
  } | null;
  /** Optional structured canvas edits from the model (applied before handwriting). */
  canvasActions?: CanvasAction[] | null;
  /** Summed token usage across parallel passes (answer + spatial). */
  usage?: TokenUsage | null;
  /** One entry per OpenAI API call (e.g. agent tool rounds). */
  usage_rounds?: TokenUsage[] | null;
  /** Same totals as `usage` (explicit sum for multi-round paths). */
  usage_total?: TokenUsage | null;
}


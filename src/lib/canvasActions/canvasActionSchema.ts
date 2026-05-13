import { z } from "zod";

const createText = z.object({
  _type: z.literal("create_text"),
  x: z.number(),
  y: z.number(),
  text: z.string().max(10_000),
});

const createGeo = z.object({
  _type: z.literal("create_geo"),
  geo: z.enum(["rectangle", "ellipse", "diamond"]),
  x: z.number(),
  y: z.number(),
  w: z.number().positive().max(5_000),
  h: z.number().positive().max(5_000),
  text: z.string().max(2_000).optional(),
  color: z.string().max(32).optional(),
});

const createArrow = z.object({
  _type: z.literal("create_arrow"),
  x1: z.number(),
  y1: z.number(),
  x2: z.number(),
  y2: z.number(),
  text: z.string().max(2_000).optional(),
  color: z.string().max(32).optional(),
});

const drawPoint = z.object({ x: z.number(), y: z.number() });
const createDraw = z.object({
  _type: z.literal("create_draw"),
  points: z.array(drawPoint).min(2).max(500),
  color: z.string().max(32).optional(),
});

const deleteShapes = z.object({
  _type: z.literal("delete_shapes"),
  shapeIds: z.array(z.string()).max(500),
});

const moveShapes = z.object({
  _type: z.literal("move_shapes"),
  shapeIds: z.array(z.string()).max(500),
  dx: z.number(),
  dy: z.number(),
});

export const canvasActionSchema = z.discriminatedUnion("_type", [
  createText,
  createGeo,
  createArrow,
  createDraw,
  deleteShapes,
  moveShapes,
]);

export const canvasActionsListSchema = z
  .array(canvasActionSchema)
  .max(50);

export type CanvasActionFromZod = z.infer<typeof canvasActionSchema>;

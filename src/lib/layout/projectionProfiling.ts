export type RectLike = { x: number; y: number; width: number; height: number };

export type ProjectionProfile = {
  xProjection: number[];
  yProjection: number[];
  wAvg: number;
  minWidth: number;
  maxWidth: number;
  sampleCount: number;
};

function toSafePositiveInt(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.max(0, Math.floor(value));
}

export function buildProjectionProfile(rects: readonly RectLike[]): ProjectionProfile {
  if (rects.length === 0) {
    return {
      xProjection: [],
      yProjection: [],
      wAvg: 0,
      minWidth: 0,
      maxWidth: 0,
      sampleCount: 0,
    };
  }

  const maxX = toSafePositiveInt(
    Math.max(...rects.map((r) => r.x + Math.max(0, r.width))),
  );
  const maxY = toSafePositiveInt(
    Math.max(...rects.map((r) => r.y + Math.max(0, r.height))),
  );

  const xProjection = new Array<number>(maxX).fill(0);
  const yProjection = new Array<number>(maxY).fill(0);

  for (const rect of rects) {
    const startX = toSafePositiveInt(rect.x);
    const endX = toSafePositiveInt(rect.x + Math.max(0, rect.width));
    const startY = toSafePositiveInt(rect.y);
    const endY = toSafePositiveInt(rect.y + Math.max(0, rect.height));

    for (let i = startX; i < endX; i += 1) xProjection[i] += 1;
    for (let i = startY; i < endY; i += 1) yProjection[i] += 1;
  }

  const widths = rects.map((r) => Math.max(0, r.width));
  const totalWidth = widths.reduce((sum, w) => sum + w, 0);
  return {
    xProjection,
    yProjection,
    wAvg: totalWidth / widths.length,
    minWidth: Math.min(...widths),
    maxWidth: Math.max(...widths),
    sampleCount: widths.length,
  };
}

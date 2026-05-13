import opentype, { type Font } from "opentype.js";

/**
 * Handwriting fonts, WOFFs in `public/fonts/`. `subsets` overrides `url` when
 * a matching script is requested. `strokeScale` tunes stroke thickness per
 * font (heavier native outlines → lower scale).
 */
export const FONT_CATALOG = {
  caveat: {
    label: "Caveat",
    url: "/fonts/Caveat-Regular.woff",
    hint: "Loopy, casual — default",
    scripts: ["latin", "latin-ext"],
    isHandwriting: true,
    strokeScale: 0.5,
  },
  "homemade-apple": {
    label: "Homemade Apple",
    url: "/fonts/HomemadeApple-Regular.woff",
    hint: "Personal handwriting, slanted",
    scripts: ["latin"],
    isHandwriting: true,
    strokeScale: 0.28,
  },
  "shadows-into-light": {
    label: "Shadows Into Light",
    url: "/fonts/ShadowsIntoLight-Regular.woff",
    hint: "Casual print, airy",
    scripts: ["latin", "latin-ext"],
    isHandwriting: true,
    strokeScale: 0.5,
  },
  kalam: {
    label: "Kalam",
    url: "/fonts/Kalam-Regular.woff",
    hint: "Natural cursive, balanced",
    scripts: ["latin", "latin-ext", "devanagari"],
    subsets: { devanagari: "/fonts/Kalam-Devanagari-Regular.woff" },
    isHandwriting: true,
    strokeScale: 0.45,
  },
  "indie-flower": {
    label: "Indie Flower",
    url: "/fonts/IndieFlower-Regular.woff",
    hint: "Friendly, rounded print",
    scripts: ["latin", "latin-ext"],
    isHandwriting: true,
    strokeScale: 0.45,
  },
  "architects-daughter": {
    label: "Architects Daughter",
    url: "/fonts/ArchitectsDaughter-Regular.woff",
    hint: "Technical print, drafting feel",
    scripts: ["latin", "latin-ext"],
    isHandwriting: true,
    strokeScale: 0.5,
  },
  "dancing-script": {
    label: "Dancing Script",
    url: "/fonts/DancingScript-Regular.woff",
    hint: "Elegant flowing cursive",
    scripts: ["latin", "latin-ext"],
    isHandwriting: true,
    strokeScale: 0.5,
  },
  "patrick-hand": {
    label: "Patrick Hand",
    url: "/fonts/PatrickHand-Regular.woff",
    hint: "Clean neutral print",
    scripts: ["latin", "latin-ext"],
    isHandwriting: true,
    strokeScale: 0.5,
  },
  amita: {
    label: "Amita",
    url: "/fonts/Amita-Latin-Regular.woff",
    hint: "Informal Devanagari handwriting",
    scripts: ["latin", "latin-ext", "devanagari"],
    subsets: { devanagari: "/fonts/Amita-Devanagari-Regular.woff" },
    isHandwriting: true,
    strokeScale: 0.5,
  },
  dekko: {
    label: "Dekko",
    url: "/fonts/Dekko-Latin-Regular.woff",
    hint: "Casual Devanagari handwriting",
    scripts: ["latin", "latin-ext", "devanagari"],
    subsets: { devanagari: "/fonts/Dekko-Devanagari-Regular.woff" },
    isHandwriting: true,
    strokeScale: 0.5,
  },
  "playpen-sans-deva": {
    label: "Playpen Sans Deva",
    url: "/fonts/PlaypenSansDeva-Latin-Regular.woff",
    hint: "Playful modern handwriting",
    scripts: ["latin", "latin-ext", "devanagari"],
    subsets: { devanagari: "/fonts/PlaypenSansDeva-Devanagari-Regular.woff" },
    isHandwriting: true,
    strokeScale: 0.5,
  },
  benne: {
    label: "Benne",
    url: "/fonts/Benne-Kannada-Regular.ttf",
    hint: "Kannada text style",
    scripts: ["kannada"],
    isHandwriting: false,
    strokeScale: 0.5,
  },
} as const satisfies Record<
  string,
  {
    label: string;
    url: string;
    hint: string;
    scripts: readonly string[];
    subsets?: Readonly<Record<string, string>>;
    isHandwriting: boolean;
    strokeScale: number;
  }
>;

export type HandwritingFontKey = keyof typeof FONT_CATALOG;

export const DEFAULT_HANDWRITING_FONT_KEY: HandwritingFontKey = "caveat";

export const DEFAULT_FONT_SCRIPT = "latin";

/** Per-(key, script) cache. Failed fetches are evicted so retries can succeed. */
const fontPromises = new Map<string, Promise<Font>>();

function cacheKey(key: HandwritingFontKey, script: string): string {
  return `${key}::${script}`;
}

function resolveFontUrl(key: HandwritingFontKey, script: string): string {
  const entry = FONT_CATALOG[key];
  const subsets = (entry as { subsets?: Readonly<Record<string, string>> })
    .subsets;
  return subsets?.[script] ?? entry.url;
}

/** Parsed opentype Font for (key, script). Back-compat: no args = default font, Latin. */
export async function loadHandwritingFont(
  key: HandwritingFontKey = DEFAULT_HANDWRITING_FONT_KEY,
  script: string = DEFAULT_FONT_SCRIPT,
): Promise<Font> {
  const cacheId = cacheKey(key, script);
  const existing = fontPromises.get(cacheId);
  if (existing) return existing;

  const url = resolveFontUrl(key, script);
  const promise = (async () => {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `Handwriting font fetch failed (${response.status} ${response.statusText}) for ${url}`,
      );
    }
    const buffer = await response.arrayBuffer();
    return opentype.parse(buffer);
  })();

  fontPromises.set(cacheId, promise);

  try {
    return await promise;
  } catch (err) {
    fontPromises.delete(cacheId);
    throw err;
  }
}

/** Reset all cached fonts — useful for tests and hot reload. */
export function resetHandwritingFontCache(): void {
  fontPromises.clear();
}

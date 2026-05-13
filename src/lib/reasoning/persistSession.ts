import type { ConversationTurn } from "../../types/vlm";

const KEY = "whiteboard:reasoningSession:v1";
const MAX_BYTES = 120_000;

export type PersistedSession = {
  v: 1;
  sessionId: string;
  turns: ConversationTurn[];
  lastSelection?: { selectedShapeIds: string[]; spatial: { x: number; y: number; width: number; height: number } } | null;
};

function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}

export function loadSession(): PersistedSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as PersistedSession;
    if (p.v !== 1 || typeof p.sessionId !== "string" || !Array.isArray(p.turns)) {
      return null;
    }
    return p;
  } catch {
    return null;
  }
}

export function saveSession(data: PersistedSession): void {
  if (typeof window === "undefined") return;
  try {
    const s = JSON.stringify(data);
    if (utf8Bytes(s) > MAX_BYTES) {
      return;
    }
    window.localStorage.setItem(KEY, s);
  } catch {
    /* quota */
  }
}

export function clearSessionStore(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* */
  }
}

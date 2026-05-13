import type { ConversationTurn } from "../../types/vlm";
import {
  CONVERSATION_TEXT_BUDGET_BYTES,
  CONVERSATION_WARN_THRESHOLD,
} from "./conversationConstants";

function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** JSON payload size for conversation + optional follow-up. */
export function estimateConversationBytes(
  conversationContext: readonly ConversationTurn[] | undefined,
  userMessage: string | null | undefined,
): number {
  const body = {
    conversationContext: conversationContext ?? [],
    userMessage: userMessage?.trim() || null,
  };
  return new TextEncoder().encode(JSON.stringify(body)).length;
}

export function isNearConversationBudget(
  bytes: number,
  budget: number = CONVERSATION_TEXT_BUDGET_BYTES,
  threshold: number = CONVERSATION_WARN_THRESHOLD,
): boolean {
  return budget > 0 && bytes >= budget * threshold;
}

const CHOP = 120;

/**
 * Return conversation turns + user message that fit in `budgetBytes` (oldest turn dropped first, then field chop, then user text chop).
 */
export function trimConversationContext(
  conversationContext: readonly ConversationTurn[],
  userMessage: string | null | undefined,
  budgetBytes: number = CONVERSATION_TEXT_BUDGET_BYTES,
): { conversationContext: ConversationTurn[]; userMessage: string | null; dropped: number } {
  const turns: ConversationTurn[] = conversationContext.map((t) => ({ ...t }));
  let u = (userMessage ?? "").trim() || null;
  let dropped = 0;

  const size = () => estimateConversationBytes(turns, u);

  while (turns.length > 0 && size() > budgetBytes) {
    turns.shift();
    dropped += 1;
  }

  for (let guard = 0; guard < 20_000 && size() > budgetBytes && turns.length > 0; guard += 1) {
    const i = turns.length - 1;
    const t = turns[i]!;
    if (t.myResponse.length > t.whatISee.length) {
      turns[i] = {
        ...t,
        myResponse: t.myResponse.slice(0, Math.max(0, t.myResponse.length - CHOP)),
      };
    } else {
      turns[i] = {
        ...t,
        whatISee: t.whatISee.slice(0, Math.max(0, t.whatISee.length - CHOP)),
      };
    }
  }

  if (u) {
    let s = u;
    for (let guard = 0; guard < 20_000 && size() > budgetBytes && s.length > 0; guard += 1) {
      s = s.slice(0, Math.max(0, s.length - CHOP));
    }
    u = s.length > 0 ? s : null;
  }

  return { conversationContext: turns, userMessage: u, dropped };
}

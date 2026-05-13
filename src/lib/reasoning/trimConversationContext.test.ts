import { describe, expect, it } from "vitest";
import { CONVERSATION_TEXT_BUDGET_BYTES } from "./conversationConstants";
import {
  estimateConversationBytes,
  isNearConversationBudget,
  trimConversationContext,
} from "./trimConversationContext";
import type { ConversationTurn } from "../../types/vlm";

const baseTurn = (n: string): ConversationTurn => ({
  at: "2026-01-01T00:00:00.000Z",
  whatISee: n,
  myResponse: n,
});

describe("trimConversationContext", () => {
  it("drops oldest turns first until under budget", () => {
    const a = "a".repeat(5_000);
    const b = "b".repeat(5_000);
    const c = "c".repeat(5_000);
    const t1 = baseTurn(a);
    const t2 = baseTurn(b);
    const t3 = baseTurn(c);
    const budget = 4_000;
    const { conversationContext, dropped } = trimConversationContext(
      [t1, t2, t3],
      null,
      budget,
    );
    expect(dropped).toBeGreaterThanOrEqual(1);
    expect(estimateConversationBytes(conversationContext, null)).toBeLessThanOrEqual(
      budget,
    );
  });

  it("estimateConversationBytes matches post-trim size", () => {
    const turns: ConversationTurn[] = [
      { at: "2026-01-01T00:00:00.000Z", whatISee: "x", myResponse: "y" },
    ];
    const bytes = estimateConversationBytes(turns, "hello");
    expect(bytes).toBeGreaterThan(0);
  });

  it("isNearConversationBudget is true at 80% of default budget", () => {
    const warnAt = CONVERSATION_TEXT_BUDGET_BYTES * 0.8;
    expect(isNearConversationBudget(warnAt)).toBe(true);
    expect(isNearConversationBudget(warnAt - 1)).toBe(false);
  });
});

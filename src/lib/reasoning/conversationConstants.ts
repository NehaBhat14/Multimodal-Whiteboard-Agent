/** Max UTF-8 bytes for serialized `conversationContext` + `userMessage` (plan default ~48–64 KiB). */
export const CONVERSATION_TEXT_BUDGET_BYTES = 64_000;

/** Warn when conversation text bytes are at or above this fraction of the budget. */
export const CONVERSATION_WARN_THRESHOLD = 0.8;

/** P2: center-distance threshold (page units) to suggest fork / new thread. */
export const SELECTION_FORK_DISTANCE_THRESHOLD = 400;

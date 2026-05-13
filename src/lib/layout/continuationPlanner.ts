export type ScriptDirection = "LTR" | "RTL" | "VERTICAL" | "UNKNOWN";

export type ContinuationDecision = {
  continuationMode: "same_column" | "next_column_top" | "truncated";
  fromColumnIndex: number;
  toColumnIndex: number | null;
};

export function planColumnContinuation(args: {
  overflowDetected: boolean;
  currentColumnIndex: number;
  availableColumnCount: number;
  scriptDirection: ScriptDirection;
}): ContinuationDecision {
  if (!args.overflowDetected) {
    return {
      continuationMode: "same_column",
      fromColumnIndex: args.currentColumnIndex,
      toColumnIndex: args.currentColumnIndex,
    };
  }

  if (args.availableColumnCount <= 1) {
    return {
      continuationMode: "truncated",
      fromColumnIndex: args.currentColumnIndex,
      toColumnIndex: null,
    };
  }

  const maxIndex = args.availableColumnCount - 1;
  let target = args.currentColumnIndex + 1;
  if (args.scriptDirection === "RTL") {
    target = args.currentColumnIndex - 1;
  }

  if (target < 0 || target > maxIndex) {
    return {
      continuationMode: "truncated",
      fromColumnIndex: args.currentColumnIndex,
      toColumnIndex: null,
    };
  }

  return {
    continuationMode: "next_column_top",
    fromColumnIndex: args.currentColumnIndex,
    toColumnIndex: target,
  };
}

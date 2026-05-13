import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Editor } from "tldraw";
import type { TextLayoutPlan } from "../../../src/lib/layout/types";
import { animateTypingTextShape } from "../../../src/lib/tldraw/animateTypingTextShape";

vi.mock("@tldraw/tlschema", () => ({
  createShapeId: () => "shape:testtyping",
}));

function makePlan(text: string): TextLayoutPlan {
  return {
    version: 1,
    placement: { x: 1, y: 2, width: 100, height: 10 },
    text,
    lineCount: text ? text.split("\n").length : 1,
    truncated: false,
    textShapeProps: {
      text,
      w: 80,
      autoSize: false,
      font: "draw",
      size: "m",
      textAlign: "start",
      color: "black",
      scale: 1,
    },
  };
}

function createMockEditor() {
  return {
    mark: vi.fn(),
    createShape: vi.fn(),
    run: vi.fn((_fn: () => void, _opts?: { history?: string }) => {
      // default: editor.run in real code invokes fn — tests that need this override per case
    }),
    updateShape: vi.fn(),
    squashToMark: vi.fn(),
    bailToMark: vi.fn(),
  };
}

describe("animateTypingTextShape", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates empty text then updates one UTF-16 unit per tick and squashes history", async () => {
    const editor = createMockEditor();
    editor.run.mockImplementation((fn: () => void) => {
      fn();
    });

    const plan = makePlan("ab");
    const p = animateTypingTextShape(editor as unknown as Editor, plan, {
      tickMs: 15,
    });

    await vi.runAllTimersAsync();
    await p;

    expect(editor.mark).toHaveBeenCalledWith("ai-typing:shape:testtyping");
    expect(editor.createShape).toHaveBeenCalledWith({
      id: "shape:testtyping",
      type: "text",
      x: 1,
      y: 2,
      props: {
        text: "",
        w: 80,
        autoSize: false,
        font: "draw",
        size: "m",
        textAlign: "start",
        color: "black",
        scale: 1,
      },
    });

    expect(editor.run).toHaveBeenCalled();
    expect(editor.updateShape).toHaveBeenNthCalledWith(1, {
      id: "shape:testtyping",
      type: "text",
      props: { text: "a" },
    });
    expect(editor.updateShape).toHaveBeenNthCalledWith(2, {
      id: "shape:testtyping",
      type: "text",
      props: { text: "ab" },
    });

    expect(editor.run.mock.calls.filter((c) => c[1]?.history === "ignore")).toHaveLength(2);

    expect(editor.squashToMark).toHaveBeenCalledWith("ai-typing:shape:testtyping");
    expect(editor.bailToMark).not.toHaveBeenCalled();
  });

  it("squashes immediately when text is empty", async () => {
    const editor = createMockEditor();
    editor.run.mockImplementation((fn: () => void) => {
      fn();
    });

    const plan = makePlan("");
    const p = animateTypingTextShape(editor as unknown as Editor, plan, { tickMs: 10 });

    await vi.runAllTimersAsync();
    await p;

    expect(editor.createShape).toHaveBeenCalled();
    expect(editor.updateShape).not.toHaveBeenCalled();
    expect(editor.squashToMark).toHaveBeenCalledWith("ai-typing:shape:testtyping");
  });

  it("preserves partial output without touching history when aborted early", async () => {
    const editor = createMockEditor();
    const ac = new AbortController();
    ac.abort();

    const plan = makePlan("z");
    await animateTypingTextShape(editor as unknown as Editor, plan, {
      signal: ac.signal,
      tickMs: 10,
    });

    // Abort paths no longer call squashToMark or bailToMark: mutating history
    // mid-run was observed to cause a visible canvas reflow. The pending mark
    // is abandoned; the next animation creates its own fresh mark.
    expect(editor.squashToMark).not.toHaveBeenCalled();
    expect(editor.bailToMark).not.toHaveBeenCalled();
    expect(editor.updateShape).not.toHaveBeenCalled();
  });

  it("preserves partial output without touching history when aborted mid-animation", async () => {
    const editor = createMockEditor();
    editor.run.mockImplementation((fn: () => void) => {
      fn();
    });

    const ac = new AbortController();
    const plan = makePlan("abc");
    const p = animateTypingTextShape(editor as unknown as Editor, plan, {
      tickMs: 20,
      signal: ac.signal,
    });

    ac.abort();

    await expect(p).resolves.toBeUndefined();

    expect(editor.squashToMark).not.toHaveBeenCalled();
    expect(editor.bailToMark).not.toHaveBeenCalled();
  });
});

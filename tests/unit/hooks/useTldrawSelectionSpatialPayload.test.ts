import React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { BoundingBox } from "../../../src/types/spatial";
import { useTldrawSelectionSpatialPayload } from "../../../src/hooks/useTldrawSelectionSpatialPayload";

vi.mock("tldraw", () => {
  return {
    useValue: (_key: string, selector: () => any, deps: unknown[] = []) => {
      const editor = deps[0] as any;

      // Only subscribe for the stabilized selection stream; interacting is derived
      // from `editor.getInstanceState()` on re-render.
      if (_key !== "selection") {
        return selector();
      }

      const [value, setValue] = React.useState(() => selector());

      React.useEffect(() => {
        if (!editor?.store?.listen) return;
        return editor.store.listen(() => {
          const isInteracting = !!editor?.getInstanceState?.().isInteracting;
          // Mimic tldraw behavior where selection is only stable after interaction ends.
          if (isInteracting) return;
          setValue(selector());
        });
      }, [editor, selector]);

      return value;
    },
  };
});

function createMockEditor(shapes: Record<string, BoundingBox>) {
  let selectedIds: string[] = [];
  let isInteracting = false;

  const listeners = new Set<() => void>();

  const editor = {
    store: {
      listen: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    getSelectedShapeIds: () => selectedIds,
    getCurrentPageShapeIds: () => Object.keys(shapes),
    getShapePageBounds: (id: string) => {
      const b = shapes[id];
      if (!b) return null;
      return {
        x: b.x,
        y: b.y,
        maxX: b.x + b.width,
        maxY: b.y + b.height,
        midX: b.x + b.width / 2,
        midY: b.y + b.height / 2,
      };
    },
    getInstanceState: () => ({
      isInteracting,
    }),
  } as any;

  return {
    editor,
    setSelection(ids: string[]) {
      selectedIds = ids;
    },
    setInteracting(v: boolean) {
      isInteracting = v;
    },
    emitStoreChange() {
      for (const l of listeners) l();
    },
    get listenerCount() {
      return listeners.size;
    },
  };
}

describe("useTldrawSelectionSpatialPayload", () => {
  it("emits only on selection finalized and clears on empty selection", () => {
    const shapes: Record<string, BoundingBox> = {
      a: { x: 0, y: 0, width: 10, height: 10 },
      b: { x: 200, y: 0, width: 10, height: 10 }, // far away (no collision)
    };

    const mock = createMockEditor(shapes);
    const { editor, setSelection, setInteracting, emitStoreChange } = mock;

    const { result, unmount } = renderHook(() =>
      useTldrawSelectionSpatialPayload(editor, 16),
    );

    // Initial selection is empty.
    expect(result.current.payload).toBeNull();
    expect(result.current.selectedShapeIds).toEqual([]);

    // Change selection but do not emit finalized => hook must not update.
    setSelection(["a"]);
    setInteracting(true);
    act(() => emitStoreChange());
    expect(result.current.payload).toBeNull();
    expect(result.current.selectedShapeIds).toEqual([]);

    act(() => {
      setInteracting(false);
      emitStoreChange();
    });

    // With no collisions, padded bbox should use full maxPadding.
    expect(result.current.payload).toEqual({
      x: -16,
      y: -16,
      width: 10 + 2 * 16,
      height: 10 + 2 * 16,
    });
    expect(result.current.selectedShapeIds).toEqual(["a"]);

    // Dedup: emitting finalized again without changing selection should not change the object reference.
    const firstPayload = result.current.payload;
    act(() => {
      emitStoreChange();
    });
    expect(result.current.payload).toBe(firstPayload);
    expect(result.current.selectedShapeIds).toEqual(["a"]);

    // Empty selection should clear only on finalized.
    setSelection([]);
    setInteracting(true);
    act(() => emitStoreChange());
    expect(result.current.payload).toBe(firstPayload);
    expect(result.current.selectedShapeIds).toEqual(["a"]);
    act(() => {
      setInteracting(false);
      emitStoreChange();
    });
    expect(result.current.payload).toBeNull();
    expect(result.current.selectedShapeIds).toEqual([]);

    const beforeUnmountListenerCount = mock.listenerCount;
    expect(beforeUnmountListenerCount).toBe(1);

    unmount();
    expect(mock.listenerCount).toBe(0);

    // Should be safe: no listeners left after cleanup.
    act(() => emitStoreChange());
  });

  it("computes union bbox for multiple selected shapes (whitespace included)", () => {
    const shapes: Record<string, BoundingBox> = {
      // Two strokes with a whitespace gap between them.
      a: { x: 0, y: 0, width: 10, height: 10 },
      b: { x: 25, y: 0, width: 10, height: 10 },
      // Far away unselected shape (should not affect safe maxPadding).
      c: { x: 1000, y: 0, width: 10, height: 10 },
    };

    const { editor, setSelection, setInteracting, emitStoreChange } =
      createMockEditor(shapes);
    const { result } = renderHook(() =>
      useTldrawSelectionSpatialPayload(editor, 16),
    );

    setSelection(["a", "b"]);
    setInteracting(false);
    act(() => {
      emitStoreChange();
    });

    // Strict union bbox:
    // minX=0, maxX=25+10=35 => width=35
    // minY=0, maxY=10 => height=10
    // Padded bbox with p=16:
    // x=0-16=-16, y=-16
    // width=35+32=67, height=10+32=42
    expect(result.current.payload).toEqual({
      x: -16,
      y: -16,
      width: 67,
      height: 42,
    });
    expect(result.current.selectedShapeIds).toEqual(["a", "b"]);
  });

  it("ignores intermediate selection changes and updates only on finalized", () => {
    const shapes: Record<string, BoundingBox> = {
      a: { x: 0, y: 0, width: 10, height: 10 },
      b: { x: 200, y: 0, width: 10, height: 10 },
    };

    const { editor, setSelection, setInteracting, emitStoreChange } =
      createMockEditor(shapes);
    const { result } = renderHook(() =>
      useTldrawSelectionSpatialPayload(editor, 16),
    );

    // Finalize selection with only 'a'
    setSelection(["a"]);
    setInteracting(false);
    act(() => {
      emitStoreChange();
    });
    const payloadA = result.current.payload;

    // Change selection to include 'b' but do NOT finalize.
    setSelection(["a", "b"]);
    setInteracting(true);
    act(() => emitStoreChange());
    expect(result.current.payload).toBe(payloadA);

    // Finalize selection with 'a' + 'b'
    act(() => {
      setInteracting(false);
      emitStoreChange();
    });
    expect(result.current.payload).toEqual({
      x: -16,
      y: -16,
      // Strict union width: (200+10)-0 = 210
      width: 210 + 32,
      height: 10 + 32,
    });

    // Remove 'b' but do NOT finalize again
    setSelection(["a"]);
    setInteracting(true);
    act(() => emitStoreChange());
    expect(result.current.payload).not.toBeNull();
    const payloadAB = result.current.payload;
    expect(payloadAB).toEqual({
      x: -16,
      y: -16,
      width: 210 + 32,
      height: 10 + 32,
    });

    // Finalize removal
    act(() => {
      setInteracting(false);
      emitStoreChange();
    });
    expect(result.current.payload).toEqual(payloadA);
  });
});


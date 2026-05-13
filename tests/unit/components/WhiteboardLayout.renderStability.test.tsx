import React, { useEffect } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import type { BoundingBox } from "../../../src/types/spatial";
import { WhiteboardLayout } from "../../../src/whiteboard/WhiteboardLayout";
import type { Editor } from "tldraw";

const shapes: Record<string, BoundingBox> = {
  a: { x: 0, y: 0, width: 10, height: 10 },
  b: { x: 200, y: 0, width: 10, height: 10 },
  c: { x: 1000, y: 0, width: 10, height: 10 },
};

let tldrawRenderCount = 0;
let selectedIds: string[] = [];
let isInteracting = false;
let storeListener: null | (() => void) = null;

// Memoized tldraw mock: calling `onMount` only once.
vi.mock("tldraw", () => {
  return {
    useValue: (_key: string, selector: () => any, deps: unknown[] = []) => {
      const editor = deps[0] as any;
      const [value, setValue] = React.useState(() => selector());

      React.useEffect(() => {
        if (!editor?.store?.listen) return;
        return editor.store.listen(() => {
          const isInteracting = !!editor?.getInstanceState?.().isInteracting;
          if (_key === "selection" && isInteracting) return;
          setValue(selector());
        });
      }, [editor, selector, _key]);

      return value;
    },
    DefaultToolbar: () => <div data-testid="default-toolbar-mock" />,
    Tldraw: (props: any) => {
      const editor = {
        store: {
          listen: (listener: () => void) => {
            storeListener = listener;
            return () => {
              storeListener = null;
            };
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
          };
        },
        getInstanceState: () => ({ isInteracting }),
        getViewportPageBounds: () => ({ x: 0, y: 0, w: 10_000, h: 10_000 }),
      } as unknown as Editor;

      tldrawRenderCount++;
      useEffect(() => {
        props.onMount?.(editor);
      }, []);

      return <div data-testid="tldraw-mock" />;
    },
  };
});

describe("WhiteboardLayout render stability", () => {
  beforeEach(() => {
    tldrawRenderCount = 0;
    selectedIds = [];
    isInteracting = false;
    storeListener = null;
  });

  it("does not re-render the canvas subtree on selection updates", async () => {
    render(<WhiteboardLayout />);

    // Wait for the canvas mock to mount and the selection hook to subscribe.
    await waitFor(() => {
      expect(tldrawRenderCount).toBeGreaterThan(0);
      expect(storeListener).not.toBeNull();
    });

    // Ensure we start with no active selection.
    expect(
      screen.getByText(/no active selection/i),
    ).toBeInTheDocument();

    // Reset render count before simulating a selection update.
    tldrawRenderCount = 0;

    // Simulate a finalized selection update.
    selectedIds = ["a"];
    isInteracting = false;

    act(() => {
      storeListener?.();
    });

    await waitFor(() => {
      expect(screen.getByText("SYSTEM")).toBeInTheDocument();
    });

    expect(tldrawRenderCount).toBeLessThanOrEqual(1);
  });
});


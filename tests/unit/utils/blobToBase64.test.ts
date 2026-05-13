import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { blobToBase64 } from "../../../src/lib/utils/blobToBase64";

function bytesToBase64(bytes: Uint8Array): string {
  // Convert bytes -> binary string -> base64 (browser-compatible).
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

class MockFileReader {
  public result: string | ArrayBuffer | null = null;

  public onload:
    | ((this: MockFileReader, ev: ProgressEvent<FileReader>) => void)
    | null = null;

  public onerror: ((this: MockFileReader, ev: ProgressEvent<FileReader>) => void) | null =
    null;

  readAsDataURL(blob: Blob): void {
    const anyBlob = blob as unknown as { arrayBuffer?: () => Promise<ArrayBuffer> };
    if (!anyBlob.arrayBuffer) {
      // Fail fast in the test setup: if Blob doesn't expose arrayBuffer,
      // we cannot deterministically generate the expected Data URL.
      throw new Error("MockFileReader requires blob.arrayBuffer() to be defined");
    }

    anyBlob.arrayBuffer().then((buf) => {
      const bytes = new Uint8Array(buf);
      const type = blob.type || "";
      const base64 = bytesToBase64(bytes);
      this.result = `data:${type};base64,${base64}`;
      this.onload?.({} as ProgressEvent<FileReader>);
    });
  }
}

describe("blobToBase64", () => {
  beforeEach(() => {
    vi.stubGlobal("FileReader", MockFileReader as unknown as typeof FileReader);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns empty string for empty Blob", async () => {
    const blob = new Blob([], { type: "image/png" });
    const result = await blobToBase64(blob);
    expect(result).toBe("");
  });

  it("returns exact Data URL string including prefix", async () => {
    const bytes = Uint8Array.from([0x01, 0x02, 0xff]);
    const blob = new Blob([bytes], { type: "image/png" });
    // jsdom Blob may not implement arrayBuffer(); stub it for determinism.
    (blob as unknown as { arrayBuffer?: () => Promise<ArrayBuffer> }).arrayBuffer =
      async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

    const expected = `data:image/png;base64,${bytesToBase64(bytes)}`;
    const result = await blobToBase64(blob);

    expect(result).toBe(expected);
  });
});


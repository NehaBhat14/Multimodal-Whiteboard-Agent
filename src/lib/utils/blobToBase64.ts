/**
 * Convert a Blob into a base64 Data URL string using the browser's `FileReader`.
 *
 * Contract: the returned string MUST include the full `data:*;base64,` prefix exactly
 * as produced by `FileReader.readAsDataURL(blob)`.
 */
export async function blobToBase64(blob: Blob): Promise<string> {
  if (blob.size === 0) return "";

  const reader = new FileReader();

  return new Promise<string>((resolve, reject) => {
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") resolve(result);
      else resolve(""); // Should not happen in practice, but keep the contract simple.
    };

    reader.onerror = () => {
      reject(new Error("Failed to read blob as Data URL"));
    };

    reader.readAsDataURL(blob);
  });
}


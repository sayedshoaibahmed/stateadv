/**
 * Shrinking a big phone photo before it is uploaded (plan M5 item 1: "compression"). Photos from a phone can be 5-10 MB;
 * a screenshot of a payment is perfectly readable at 1,600 pixels. The DECISIONS are plain functions (tested); the
 * drawing happens in the browser only (`compressImage`), and if anything about it fails the ORIGINAL file is used,
 * so compression can never lose a proof. The server still checks the real content, size and SHA-256 after upload.
 * PDFs and small files are never touched. The picture's type stays what it was (JPEG, PNG or WEBP).
 */
export const COMPRESS_OVER_BYTES = 1024 * 1024; // only files above 1 MB are worth shrinking
export const MAX_EDGE = 1600; // longest side in pixels after shrinking
export const JPEG_QUALITY = 0.82;

const COMPRESSIBLE = ["image/jpeg", "image/webp", "image/png"];

export const shouldCompress = (f: { type: string; size: number }): boolean =>
  COMPRESSIBLE.includes(f.type) && f.size > COMPRESS_OVER_BYTES;

/** The size to draw at: the longest side becomes `max`, the shape stays, nothing is ever enlarged. */
export function fitWithin(
  width: number,
  height: number,
  max: number = MAX_EDGE,
): { width: number; height: number } {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  )
    return { width: 0, height: 0 };
  const longest = Math.max(width, height);
  if (longest <= max)
    return { width: Math.round(width), height: Math.round(height) };
  const scale = max / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Use the shrunk file only if it is really smaller; otherwise keep the original. */
export const pickSmaller = <T extends { size: number }>(
  original: T,
  shrunk: T | null,
): T =>
  shrunk && shrunk.size > 0 && shrunk.size < original.size ? shrunk : original;

/** Browser only. Returns the shrunk file, or the original when shrinking is not needed, not possible or not smaller. */
export async function compressImage(file: File): Promise<File> {
  if (
    !shouldCompress(file) ||
    typeof document === "undefined" ||
    typeof createImageBitmap !== "function"
  )
    return file;
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    if (width === 0) return file;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const type =
      file.type === "image/png"
        ? "image/png"
        : file.type === "image/webp"
          ? "image/webp"
          : "image/jpeg";
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob(resolve, type, JPEG_QUALITY),
    );
    if (!blob) return file;
    const out = new File([blob], file.name, {
      type,
      lastModified: file.lastModified,
    });
    return pickSmaller(file, out);
  } catch {
    return file;
  }
}

/**
 * Validates image bytes before they are treated as a generated file.
 * A prompt, URL or text record never passes this check.
 */

export const MAX_GENERATED_IMAGE_BYTES = 8 * 1024 * 1024;

export type RasterMime = 'image/png' | 'image/jpeg' | 'image/webp';

export type ImageInspection =
  | { ok: true; mimeType: RasterMime; width: number | null; height: number | null }
  | { ok: false; message: string };

export function inspectImageBytes(bytes: Uint8Array): ImageInspection {
  if (bytes.byteLength < 24) {
    return { ok: false, message: 'The provider returned an empty or truncated file. Nothing was saved.' };
  }
  if (bytes.byteLength > MAX_GENERATED_IMAGE_BYTES) {
    return {
      ok: false,
      message: `The image is ${bytes.byteLength} bytes, above the ${MAX_GENERATED_IMAGE_BYTES} byte limit. Nothing was saved.`,
    };
  }
  if (isPng(bytes)) {
    const size = pngSize(bytes);
    return { ok: true, mimeType: 'image/png', width: size?.width ?? null, height: size?.height ?? null };
  }
  if (isJpeg(bytes)) {
    const size = jpegSize(bytes);
    return { ok: true, mimeType: 'image/jpeg', width: size?.width ?? null, height: size?.height ?? null };
  }
  if (isWebp(bytes)) {
    return { ok: true, mimeType: 'image/webp', width: null, height: null };
  }
  return {
    ok: false,
    message: 'The provider response was not a PNG, JPEG or WebP file. No placeholder was saved.',
  };
}

function isPng(bytes: Uint8Array): boolean {
  return (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  );
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function isWebp(bytes: Uint8Array): boolean {
  return (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  );
}

function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.byteLength < 24) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width === 0 || height === 0 || width > 8192 || height > 8192) return null;
  return { width, height };
}

function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 9 < bytes.byteLength) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1] ?? 0;
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    const length = view.getUint16(offset + 2);
    if (length < 2) return null;
    // SOF0, SOF1, SOF2
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      const height = view.getUint16(offset + 5);
      const width = view.getUint16(offset + 7);
      if (width === 0 || height === 0) return null;
      return { width, height };
    }
    offset += 2 + length;
  }
  return null;
}

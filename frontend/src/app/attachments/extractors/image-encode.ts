import { AttachmentProcessingError } from '../attachment.types';

/**
 * Re-encodes an image in the worker via createImageBitmap + OffscreenCanvas
 * (both available in Web Workers). Re-encoding strips EXIF/location metadata and
 * downscales to a model-friendly size, producing the bytes we both store and
 * send to vision models.
 */
export interface ReencodedImage {
  bytes: Uint8Array;
  mimeType: string;
  width: number;
  height: number;
}

// Long-edge cap — keeps requests cheap and within common vision-model limits.
const MAX_IMAGE_DIMENSION = 1568;
const OUTPUT_MIME = 'image/webp';
const OUTPUT_QUALITY = 0.85;

export const reencodeImage = async (
  bytes: Uint8Array,
  declaredMime: string,
): Promise<ReencodedImage> => {
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const blob = new Blob([buffer], { type: declaredMime || 'image/png' });

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    throw new AttachmentProcessingError(
      'image_decode_failed',
      'Could not decode image',
    );
  }

  try {
    const scale = Math.min(
      1,
      MAX_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height),
    );
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new AttachmentProcessingError('image_decode_failed', 'Canvas unavailable');
    }
    ctx.drawImage(bitmap, 0, 0, width, height);

    const outBlob = await canvas.convertToBlob({
      type: OUTPUT_MIME,
      quality: OUTPUT_QUALITY,
    });
    const outBytes = new Uint8Array(await outBlob.arrayBuffer());
    return { bytes: outBytes, mimeType: outBlob.type || OUTPUT_MIME, width, height };
  } finally {
    bitmap.close();
  }
};

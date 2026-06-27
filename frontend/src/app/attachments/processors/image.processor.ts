import { Base64 } from 'js-base64';

import {
  AttachmentProcessor,
  ProcessorInput,
  ProcessorOutput,
} from '../attachment.types';
import { ReencodedImage, reencodeImage } from '../extractors/image-encode';

export type ImageEncoder = (
  bytes: Uint8Array,
  declaredMime: string,
) => Promise<ReencodedImage>;

const SUPPORTED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'] as const;
const SUPPORTED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

/**
 * ImageProcessor re-encodes images (stripping EXIF, downscaling) for vision
 * models. It stores the encrypted re-encoded image and emits a transient
 * base64 image context for the completion request. The encoder is injected so
 * the processor unit-tests without OffscreenCanvas.
 */
export class ImageProcessor implements AttachmentProcessor {
  readonly id = 'image';
  readonly version = '1';
  readonly supportedExtensions = SUPPORTED_EXTENSIONS;
  readonly supportedMimeTypes = SUPPORTED_MIME_TYPES;
  readonly maxBytes = Number.POSITIVE_INFINITY;

  constructor(private readonly encode: ImageEncoder = reencodeImage) {}

  canProcess(input: ProcessorInput): boolean {
    return (
      input.detectedType.family === 'image' ||
      this.supportedExtensions.includes(
        input.detectedType.extension as (typeof SUPPORTED_EXTENSIONS)[number],
      ) ||
      input.detectedType.detectedMimeType.startsWith('image/')
    );
  }

  async process(input: ProcessorInput): Promise<ProcessorOutput> {
    const image = await this.encode(input.bytes, input.detectedType.detectedMimeType);
    return {
      normalizedType: image.mimeType,
      artifacts: [
        {
          kind: 'model_image',
          mimeType: image.mimeType,
          bytes: image.bytes,
        },
      ],
      ai: {
        hasTextContext: false,
        imageContext: {
          base64: Base64.fromUint8Array(image.bytes),
          mimeType: image.mimeType,
          width: image.width,
          height: image.height,
        },
      },
    };
  }
}

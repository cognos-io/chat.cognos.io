import { detectFileType } from '../attachment-type-detection';
import { ProcessorInput, defaultAttachmentLimits } from '../attachment.types';
import { ImageProcessor } from './image.processor';

const inputFor = (fileName: string, mime = ''): ProcessorInput => ({
  fileName,
  bytes: Uint8Array.from([1, 2, 3, 4]),
  detectedType: detectFileType(fileName, mime),
  limits: defaultAttachmentLimits(),
});

describe('ImageProcessor (injected encoder)', () => {
  const encoder = async () => ({
    bytes: Uint8Array.from([9, 9, 9]),
    mimeType: 'image/webp',
    width: 800,
    height: 600,
  });

  it('accepts supported image types', () => {
    const p = new ImageProcessor(encoder);
    expect(p.canProcess(inputFor('cat.png'))).toBe(true);
    expect(p.canProcess(inputFor('cat.jpg'))).toBe(true);
    expect(p.canProcess(inputFor('blob', 'image/webp'))).toBe(true);
    expect(p.canProcess(inputFor('notes.txt'))).toBe(false);
  });

  it('produces a model_image artifact and a base64 image context (no text)', async () => {
    const p = new ImageProcessor(encoder);
    const out = await p.process(inputFor('cat.png'));

    expect(out.artifacts).toHaveLength(1);
    expect(out.artifacts[0].kind).toBe('model_image');
    expect(out.artifacts[0].mimeType).toBe('image/webp');

    expect(out.ai.hasTextContext).toBe(false);
    expect(out.ai.imageContext).toEqual({
      base64: 'CQkJ', // base64 of [9,9,9]
      mimeType: 'image/webp',
      width: 800,
      height: 600,
    });
  });

  it('surfaces a decode failure from the encoder', async () => {
    const p = new ImageProcessor(async () => {
      throw new Error('bad image');
    });
    await expect(p.process(inputFor('cat.png'))).rejects.toThrow();
  });
});

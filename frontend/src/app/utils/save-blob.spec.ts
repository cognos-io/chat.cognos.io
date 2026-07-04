import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { saveBlob } from './save-blob';

describe('saveBlob', () => {
  let createObjectURL: ReturnType<typeof vi.spyOn>;
  let revokeObjectURL: ReturnType<typeof vi.spyOn>;
  let click: ReturnType<typeof vi.spyOn>;
  let remove: ReturnType<typeof vi.spyOn>;
  let anchor: HTMLAnchorElement;
  let createElement: ReturnType<typeof vi.spyOn>;
  let appendChild: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    anchor = document.createElement('a');
    click = vi.spyOn(anchor, 'click').mockImplementation(() => {});
    remove = vi.spyOn(anchor, 'remove').mockImplementation(() => {});

    createElement = vi.spyOn(document, 'createElement').mockReturnValue(anchor);
    appendChild = vi
      .spyOn(document.body, 'appendChild')
      .mockImplementation((node) => node);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('downloads a Blob under the given filename', () => {
    const blob = new Blob(['hello'], { type: 'text/plain' });

    saveBlob(blob, 'greeting.txt');

    expect(createElement).toHaveBeenCalledWith('a');
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(anchor.href).toBe('blob:mock-url');
    expect(anchor.download).toBe('greeting.txt');
    expect(appendChild).toHaveBeenCalledWith(anchor);
    expect(click).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it('wraps a Uint8Array in a Blob with the given mime type', () => {
    const bytes = new Uint8Array([1, 2, 3]);

    saveBlob(bytes, 'data.bin', 'application/octet-stream');

    expect(createObjectURL).toHaveBeenCalledOnce();
    const passedBlob = createObjectURL.mock.calls[0][0] as Blob;
    expect(passedBlob).toBeInstanceOf(Blob);
    expect(passedBlob.type).toBe('application/octet-stream');
    expect(anchor.download).toBe('data.bin');
  });
});

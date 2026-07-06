import {
  extractClipboardFiles,
  isAcceptedFile,
  isImageFile,
} from './attachment-accept';

const file = (name: string, type: string): File => new File(['x'], name, { type });

/**
 * Minimal DataTransfer stand-in — jsdom doesn't implement DataTransfer, and the
 * helper only touches `.items` (kind + getAsFile) and `.files`.
 */
const clipboard = (opts: { items?: File[]; files?: File[] }): DataTransfer => {
  const items = (opts.items ?? []).map((f) => ({
    kind: 'file' as const,
    getAsFile: () => f,
  }));
  // A pasted plain-string is represented as a non-file item and must be ignored.
  const stringItem = { kind: 'string' as const, getAsFile: () => null };
  return {
    items: [...items, ...(opts.items ? [stringItem] : [])],
    files: opts.files ?? [],
  } as unknown as DataTransfer;
};

describe('isImageFile', () => {
  it.each([
    ['photo.png', 'image/png', true],
    ['scan.JPG', '', true],
    ['note.txt', 'text/plain', false],
    ['data', 'image/webp', true],
  ])('%s (%s) -> %s', (name, type, expected) => {
    expect(isImageFile(file(name, type))).toBe(expected);
  });
});

describe('isAcceptedFile', () => {
  it.each([
    ['photo.png', 'image/png', true],
    ['report.pdf', 'application/pdf', true],
    ['notes.txt', 'text/plain', true],
    ['data.json', 'application/json', true],
    ['unknown.exe', 'application/octet-stream', false],
    ['plain', 'text/plain', true], // by MIME when extension is absent
    ['archive.zip', 'application/zip', false],
  ])('%s (%s) -> %s', (name, type, expected) => {
    expect(isAcceptedFile(file(name, type))).toBe(expected);
  });
});

describe('extractClipboardFiles', () => {
  it('returns [] for null clipboard', () => {
    expect(extractClipboardFiles(null)).toEqual([]);
  });

  it('returns [] when only plain text is on the clipboard', () => {
    expect(extractClipboardFiles(clipboard({}))).toEqual([]);
  });

  it('returns pasted image files', () => {
    const result = extractClipboardFiles(
      clipboard({ items: [file('image.png', 'image/png')] }),
    );
    expect(result.map((f) => f.name)).toEqual(['image.png']);
  });

  it('returns other supported file types (pdf, txt)', () => {
    const result = extractClipboardFiles(
      clipboard({
        items: [file('report.pdf', 'application/pdf'), file('notes.txt', 'text/plain')],
      }),
    );
    expect(result.map((f) => f.name)).toEqual(['report.pdf', 'notes.txt']);
  });

  it('drops unsupported types, keeps supported ones from a mixed clipboard', () => {
    const result = extractClipboardFiles(
      clipboard({
        items: [
          file('app.exe', 'application/octet-stream'),
          file('a.png', 'image/png'),
        ],
      }),
    );
    expect(result.map((f) => f.name)).toEqual(['a.png']);
  });

  it('normalises a blank filename to a stable pasted name', () => {
    const result = extractClipboardFiles(clipboard({ items: [file('', 'image/png')] }));
    expect(result.map((f) => f.name)).toEqual(['pasted-image.png']);
    expect(result[0].type).toBe('image/png');
  });

  it('falls back to the files list when items are absent', () => {
    const result = extractClipboardFiles(
      clipboard({ files: [file('image.png', 'image/png')] }),
    );
    expect(result.map((f) => f.name)).toEqual(['image.png']);
  });
});

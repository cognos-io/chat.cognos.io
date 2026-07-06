/**
 * The file extensions the composer offers in V1 (spec §5.3). Used for the file
 * picker `accept` attribute and as a first-pass filter on drag/drop. The worker
 * still re-validates every file (fail closed), so this is UX, not security.
 */
export const ACCEPTED_ATTACHMENT_EXTENSIONS = [
  '.txt',
  '.md',
  '.markdown',
  '.csv',
  '.json',
  '.pdf',
  '.docx',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
] as const;

export const ACCEPTED_ATTACHMENT_ACCEPT = ACCEPTED_ATTACHMENT_EXTENSIONS.join(',');

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'];

/** MIME types we accept for the non-image types (first-pass filter only). */
const ACCEPTED_MIME_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

/** MIME → extension for naming clipboard blobs that arrive without a filename. */
const IMAGE_MIME_EXTENSION: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/** Lower-cased extension without the dot, or '' when there is none. */
const fileExtension = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
};

/** True for files the image processor handles — gated to vision models. */
export const isImageFile = (file: File): boolean => {
  if (file.type.startsWith('image/')) {
    return true;
  }
  return IMAGE_EXTENSIONS.includes(fileExtension(file.name));
};

/**
 * First-pass accept filter for any supported attachment type (images, text,
 * markdown, csv, json, pdf, docx). Mirrors the picker/drop contract: purely UX,
 * the worker re-validates and fails closed. Used to keep pasted non-file content
 * (plain/rich text, HTML) from being treated as an attachment.
 */
export const isAcceptedFile = (file: File): boolean => {
  if (isImageFile(file)) {
    return true;
  }
  const ext = fileExtension(file.name);
  if (
    ext &&
    (ACCEPTED_ATTACHMENT_EXTENSIONS as readonly string[]).includes(`.${ext}`)
  ) {
    return true;
  }
  return ACCEPTED_MIME_TYPES.has(file.type);
};

/**
 * Pull supported files out of a clipboard (or drag) DataTransfer, so a paste can
 * be routed through the same intake as drag-drop. Prefers `items` (the reliable
 * source for pasted content) and falls back to `files`. Blobs that arrive without
 * a filename — typical for pasted screenshots — are renamed so the library/chip
 * UI stays readable; dedup is by content hash, so the name is cosmetic only.
 * Non-file content is ignored, leaving the browser's default paste untouched.
 */
export const extractClipboardFiles = (data: DataTransfer | null): File[] => {
  if (!data) {
    return [];
  }

  const raw: File[] = [];
  if (data.items && data.items.length > 0) {
    for (const item of Array.from(data.items)) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) {
          raw.push(file);
        }
      }
    }
  }
  if (raw.length === 0 && data.files && data.files.length > 0) {
    raw.push(...Array.from(data.files));
  }

  return raw.filter(isAcceptedFile).map(withPastedName);
};

/** Give an unnamed clipboard blob a stable, human-readable filename. */
const withPastedName = (file: File): File => {
  if (file.name && file.name.trim().length > 0) {
    return file;
  }
  const isImage = file.type.startsWith('image/');
  const ext = IMAGE_MIME_EXTENSION[file.type] ?? file.type.split('/')[1] ?? 'bin';
  const base = isImage ? 'pasted-image' : 'pasted-file';
  return new File([file], `${base}.${ext}`, {
    type: file.type,
    lastModified: file.lastModified,
  });
};

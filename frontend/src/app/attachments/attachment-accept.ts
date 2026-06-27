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
  '.xlsx',
  '.xls',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
] as const;

export const ACCEPTED_ATTACHMENT_ACCEPT = ACCEPTED_ATTACHMENT_EXTENSIONS.join(',');

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'];

/** True for files the image processor handles — gated to vision models. */
export const isImageFile = (file: File): boolean => {
  if (file.type.startsWith('image/')) {
    return true;
  }
  const dot = file.name.lastIndexOf('.');
  const ext = dot >= 0 ? file.name.slice(dot + 1).toLowerCase() : '';
  return IMAGE_EXTENSIONS.includes(ext);
};

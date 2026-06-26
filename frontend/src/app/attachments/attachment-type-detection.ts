import { DetectedFileType } from './attachment.types';

/**
 * V1 type detection: extension + declared MIME only. Text decodability is
 * verified by the text processor itself (which fails closed on non-UTF-8).
 * Images/PDFs will add magic-byte sniffing here later.
 */

const TEXT_EXTENSIONS: Record<string, string> = {
  txt: 'text/plain',
  text: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
};

export const extensionOf = (fileName: string): string => {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0 || dot === fileName.length - 1) {
    return '';
  }
  return fileName.slice(dot + 1).toLowerCase();
};

export const detectFileType = (
  fileName: string,
  declaredMimeType: string,
): DetectedFileType => {
  const extension = extensionOf(fileName);
  const declared = (declaredMimeType || '').toLowerCase();

  const textMimeFromExt = TEXT_EXTENSIONS[extension];
  const declaredIsText =
    declared.startsWith('text/') ||
    declared === 'application/json' ||
    declared === 'application/csv';

  if (textMimeFromExt || declaredIsText) {
    return {
      extension,
      declaredMimeType: declared,
      detectedMimeType: textMimeFromExt ?? declared ?? 'text/plain',
      family: 'text',
    };
  }

  return {
    extension,
    declaredMimeType: declared,
    detectedMimeType: declared || 'application/octet-stream',
    family: 'unknown',
  };
};

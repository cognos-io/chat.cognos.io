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
] as const;

export const ACCEPTED_ATTACHMENT_ACCEPT = ACCEPTED_ATTACHMENT_EXTENSIONS.join(',');

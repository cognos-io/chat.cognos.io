/**
 * Lazy DOCX text extraction via mammoth. mammoth.extractRawText reads the
 * document's text content (ignoring styling) from an ArrayBuffer — pure enough
 * to run inside the attachment worker. Lazy-imported to keep the bundle small.
 */
export const extractDocxText = async (bytes: Uint8Array): Promise<string> => {
  const mammoth = await import('mammoth');
  // Copy into a standalone ArrayBuffer (the view may be a transferred slice).
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  return result.value ?? '';
};

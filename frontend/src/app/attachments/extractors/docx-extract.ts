interface MammothModule {
  extractRawText(options: { arrayBuffer: ArrayBuffer }): Promise<{ value: string }>;
}

/**
 * Lazy DOCX text extraction via mammoth. mammoth.extractRawText reads the
 * document's text content (ignoring styling) from an ArrayBuffer — pure enough
 * to run inside the attachment worker. Lazy-imported to keep the bundle small.
 *
 * mammoth is a CommonJS package whose exports object is a Proxy
 * (mammoth/lib/index.js) — bundlers that statically scan a CJS module for
 * named exports (as the worker chunk's esbuild pre-bundle does) can't see
 * through a Proxy, so the dynamic import resolves to only a `default`
 * property instead of flattening `extractRawText` onto the namespace. Other
 * contexts (e.g. Node's CJS interop under vitest) resolve it directly on the
 * namespace with no `default` wrapper. Support both shapes rather than
 * assuming one — this previously threw "mammoth.extractRawText is not a
 * function" for every real .docx (composer upload or Save-to-library),
 * silently downgraded to the generic "Could not read this file" error.
 */
export const extractDocxText = async (bytes: Uint8Array): Promise<string> => {
  const imported = await import('mammoth');
  const namespace = imported as unknown as MammothModule & {
    default?: MammothModule;
  };
  const mammoth: MammothModule =
    typeof namespace.extractRawText === 'function' ? namespace : namespace.default!;
  // Copy into a standalone ArrayBuffer (the view may be a transferred slice).
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  return result.value ?? '';
};

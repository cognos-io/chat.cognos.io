// Markdown "render" is a pass-through: the document source already IS the
// file (spec docs/specs/document-generation.md §7). No Angular imports; runs
// inside the render worker as well as the main thread.
export const renderMarkdownFile = (markdown: string): Uint8Array =>
  new TextEncoder().encode(markdown);

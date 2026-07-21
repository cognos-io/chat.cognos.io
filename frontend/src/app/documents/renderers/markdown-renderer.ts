// Markdown "render" is a pass-through: the document source already IS the
// file (docs/business_processes/document-generation.md). No Angular imports; runs
// inside the render worker as well as the main thread.
export const renderMarkdownFile = (markdown: string): Uint8Array =>
  new TextEncoder().encode(markdown);

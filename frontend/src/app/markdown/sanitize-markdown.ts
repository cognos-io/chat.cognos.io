import DOMPurify from 'dompurify';

// Angular's built-in HTML sanitizer strips elements that GitHub/Obsidian
// markdown relies on (task-list checkboxes, callout SVG icons, footnote
// anchors). DOMPurify keeps a vetted allowlist for those while still removing
// scripts, event handlers and unsafe URLs from untrusted model output.
//
// Model output is untrusted: a compromised or prompt-injected response could
// otherwise render a full-viewport `style` overlay (UI redress) or a
// credential-harvesting `<form>` disguised as our own Account Key prompt.
// Since an Account Key lives in this app's memory, that is a real phishing
// vector, so we forbid `style`, `form` and its input controls outright — none
// of which legitimate markdown needs.
const FORBID_TAGS = ['form', 'input', 'button', 'textarea', 'select', 'option'];
const FORBID_ATTR = ['style'];

export const sanitizeMarkdown = (html: string): string =>
  DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, svg: true, mathMl: true },
    FORBID_TAGS,
    FORBID_ATTR,
  });

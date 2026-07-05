// Progressive markdown rendering for streamed assistant messages.
//
// While a message streams in token-by-token, we don't want to render markdown
// on the whole buffer every tick — a half-typed `**bold` or an open ``` fence
// would flash raw asterisks / render broken, then reflow. Instead we split the
// accumulated text into a STABLE prefix (blocks that are definitely complete,
// safe to render as HTML) and an in-progress TAIL (rendered as plain text until
// it closes, at which point it migrates into the prefix on a later tick).
//
// A block is treated as complete once a blank line follows it — the boundary
// that separates paragraphs, headings, whole lists and whole fenced blocks in
// the markdown most models emit. We NEVER split inside an open code fence
// (``` / ~~~) or an open `$$` display-math block: those only close on their
// own delimiter, and cutting inside them would render broken output.
//
// Consequences worth knowing:
//   - Inline emphasis (**bold**, _italic_) only styles once its closing
//     delimiter arrives, because the run stays in the tail until the block ends.
//   - A growing list renders as one unit when the list ends (blank line), not
//     item-by-item. That's the deliberate trade-off for a robust, flash-free
//     split; per-item granularity would need to descend into list tokens.

export interface StreamingMarkdownSplit {
  /** Complete blocks, safe to render as HTML. */
  stable: string;
  /** The in-progress block, to show as plain text until it completes. */
  tail: string;
}

// A fence line opens/closes a code block: three or more backticks or tildes,
// optionally indented and (on open) followed by an info string.
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;

export const splitStreamingMarkdown = (
  content: string | null | undefined,
): StreamingMarkdownSplit => {
  if (!content) {
    return { stable: '', tail: content ?? '' };
  }

  const lines = content.split('\n');
  let offset = 0; // char offset of the start of the current line
  let inFence = false;
  let fenceChar = ''; // '`' or '~' — the delimiter that opened the fence
  let inMath = false;
  let openBlockStart = 0; // offset where the currently-open fence/math began
  let lastBoundary = 0; // offset just past the last top-level blank line

  for (const line of lines) {
    const trimmed = line.trim();
    const fenceMatch = FENCE_RE.exec(line);

    if (fenceMatch && !inMath) {
      if (!inFence) {
        inFence = true;
        fenceChar = fenceMatch[1][0];
        openBlockStart = offset;
      } else if (fenceMatch[1][0] === fenceChar) {
        // A matching-delimiter fence line closes the block.
        inFence = false;
      }
    } else if (!inFence && trimmed === '$$') {
      if (!inMath) {
        inMath = true;
        openBlockStart = offset;
      } else {
        inMath = false;
      }
    } else if (!inFence && !inMath && trimmed === '') {
      // A blank line at the top level closes the preceding block.
      lastBoundary = offset + line.length + 1;
    }

    offset += line.length + 1; // +1 for the '\n' consumed by split
  }

  // If the stream cut off mid-fence or mid-math, that open block must stay in
  // the tail — even if a blank line appeared inside it.
  let boundary = lastBoundary;
  if ((inFence || inMath) && openBlockStart < boundary) {
    boundary = openBlockStart;
  }
  boundary = Math.min(boundary, content.length);

  return { stable: content.slice(0, boundary), tail: content.slice(boundary) };
};

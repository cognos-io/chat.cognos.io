// Pure DOM helper for swapping redaction placeholder tokens inside already
// rendered markup with caller-supplied pill nodes. Kept separate from the
// Angular component so the (fiddly) text-node surgery is unit-testable without
// a markdown renderer.

const TOKEN_SOURCE = '\\[\\[PII_[A-Z]+_[A-Z0-9]+\\]\\]';

/**
 * Walk every text node under `root` and replace each placeholder token for
 * which `hasEntry` is true with the node returned by `makePill`. Surrounding
 * text and markup are preserved. Tokens without an entry are left as-is.
 */
export function injectRedactionPills(
  root: Node,
  hasEntry: (token: string) => boolean,
  makePill: (token: string) => Node,
): void {
  const detect = new RegExp(TOKEN_SOURCE);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.nodeValue && detect.test(node.nodeValue)) {
      targets.push(node as Text);
    }
  }
  for (const textNode of targets) {
    replaceInTextNode(textNode, hasEntry, makePill);
  }
}

function replaceInTextNode(
  textNode: Text,
  hasEntry: (token: string) => boolean,
  makePill: (token: string) => Node,
): void {
  const text = textNode.nodeValue ?? '';
  const re = new RegExp(TOKEN_SOURCE, 'g');
  const fragment = document.createDocumentFragment();
  let lastIndex = 0;
  let replaced = false;
  let match: RegExpExecArray | null;

  while ((match = re.exec(text))) {
    if (!hasEntry(match[0])) {
      continue;
    }
    replaced = true;
    if (match.index > lastIndex) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    }
    fragment.appendChild(makePill(match[0]));
    lastIndex = match.index + match[0].length;
  }

  if (!replaced) {
    return;
  }
  if (lastIndex < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
  }
  textNode.parentNode?.replaceChild(fragment, textNode);
}

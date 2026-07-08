/**
 * Shared "scroll to a specific message" helpers used by the conversation
 * minimap (jump to a user turn) and by bookmarks (jump back to a saved
 * message). Kept as pure functions so the DOM logic is unit-testable without
 * standing up the whole message-list component + its providers.
 *
 * Each rendered message `<li>` carries `[id]="message.record_id"` (see
 * message-list-item.component), so a persisted message can be located by its
 * PocketBase record id. Messages in temporary/incognito chats — and the
 * still-streaming assistant reply — have no `record_id` yet, so lookups return
 * null and callers should treat "not found" as a soft failure.
 */

/** Find a rendered message element by its persisted record id within a container. */
export function findMessageElement(
  container: ParentNode | null | undefined,
  recordId: string | null | undefined,
): HTMLElement | null {
  if (!container || !recordId) {
    return null;
  }
  // Match by exact id rather than a `#id`/`[id="…"]` CSS selector so that ids
  // containing selector-special characters need no escaping (and we don't
  // depend on CSS.escape being present in every runtime).
  const candidates = container.querySelectorAll<HTMLElement>('[id]');
  for (const el of Array.from(candidates)) {
    if (el.id === recordId) {
      return el;
    }
  }
  return null;
}

/**
 * Scroll the message with `recordId` into the centre of its scroll container
 * and return whether it was found. `false` means the target isn't in the
 * currently rendered branch/page (paginated out, temporary chat, or still
 * streaming), letting callers decide how to react (e.g. show a hint).
 */
export function scrollMessageIntoView(
  container: HTMLElement | null | undefined,
  recordId: string | null | undefined,
  smooth = true,
): boolean {
  const target = findMessageElement(container, recordId);
  if (!target) {
    return false;
  }
  target.scrollIntoView({
    block: 'center',
    behavior: smooth ? 'smooth' : 'instant',
  });
  return true;
}

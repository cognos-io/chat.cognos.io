import { type Message, isMessageFromUser } from '@app/interfaces/message';

/**
 * A single minimap tick: one user turn in the currently-active branch, with a
 * short text preview shown on hover and the persisted `id` used to jump back.
 */
export interface MinimapTick {
  /** Persisted message record id — the scroll/jump target. */
  id: string;
  /** Collapsed, truncated first characters of the user turn for the preview. */
  preview: string;
}

export const MINIMAP_MAX_TICKS = 20;
export const MINIMAP_PREVIEW_CHARS = 100;

/** Collapse whitespace and truncate to `max` characters (code-point safe). */
export function truncatePreview(content: string, max = MINIMAP_PREVIEW_CHARS): string {
  const collapsed = content.replace(/\s+/g, ' ').trim();
  const chars = [...collapsed];
  if (chars.length <= max) {
    return collapsed;
  }
  return chars.slice(0, max).join('').trimEnd() + '…';
}

/**
 * Derive the minimap ticks from the active branch's messages: one per
 * non-deleted USER turn that has a persisted record id (temporary-chat and
 * still-streaming messages have none and can't be jumped to), keeping only the
 * most recent `maxTicks`. Assistant turns are excluded — the minimap indexes
 * the user's own questions, which is how people navigate a long chat.
 */
export function deriveMinimapTicks(
  messages: readonly Message[],
  maxTicks = MINIMAP_MAX_TICKS,
  previewChars = MINIMAP_PREVIEW_CHARS,
): MinimapTick[] {
  const ticks: MinimapTick[] = [];
  for (const message of messages) {
    if (!message.record_id) {
      continue;
    }
    if (message.decryptedData.deleted) {
      continue;
    }
    if (!isMessageFromUser(message.decryptedData)) {
      continue;
    }
    ticks.push({
      id: message.record_id,
      preview: truncatePreview(message.decryptedData.content ?? '', previewChars),
    });
  }
  return ticks.slice(-maxTicks);
}

/**
 * Given the ordered tick ids and the set currently visible in the viewport,
 * pick the "you are here" tick: the last (most recent) visible one. Returns
 * null when nothing is visible (e.g. before the first intersection callback).
 */
export function pickActiveTickId(
  orderedIds: readonly string[],
  visibleIds: ReadonlySet<string>,
): string | null {
  for (let i = orderedIds.length - 1; i >= 0; i--) {
    if (visibleIds.has(orderedIds[i])) {
      return orderedIds[i];
    }
  }
  return null;
}

// deriveProfileName produces a human-ish label for the sidebar avatar. We keep
// the surface privacy-preserving: when the user hasn't set a display name we
// only ever render the derived initials (never the raw email), so the label
// here feeds the avatar's initials/aria — it is not shown verbatim.
//
// A set display name wins. Otherwise we title-case the email's local-part,
// splitting on common separators so "ewan.jones@…" → "Ewan Jones" (initials
// "EJ"). Returns '' when there is nothing to derive.
export const deriveProfileName = (
  displayName: string | null | undefined,
  email: string | null | undefined,
): string => {
  const trimmed = (displayName ?? '').trim();
  if (trimmed) {
    return trimmed;
  }

  const localPart = (email ?? '').split('@')[0] ?? '';
  const words = localPart.split(/[._+-]+/).filter(Boolean);
  if (words.length === 0) {
    return '';
  }

  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
};

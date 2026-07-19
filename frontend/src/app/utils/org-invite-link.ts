/**
 * buildOrgInviteUrl — absolute invite deep link for sharing.
 *
 * Recipients sign in (or create an Account) and open `/invite?token=…` to
 * join the Organisation. The token is URL-encoded so hex and future formats
 * stay safe in query strings.
 */
export function buildOrgInviteUrl(token: string, origin: string): string {
  const trimmed = token.trim();
  if (!trimmed) {
    return '';
  }

  const base = origin.replace(/\/$/, '');
  return `${base}/invite?token=${encodeURIComponent(trimmed)}`;
}

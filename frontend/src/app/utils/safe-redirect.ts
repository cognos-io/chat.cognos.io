/**
 * safeInternalUrl — validates a post-login redirect target (the `next` query
 * parameter) so it can never become an open redirect.
 *
 * Only app-internal targets are honoured: the value must start with a single
 * '/' — which rules out absolute URLs (`https://evil.example`), scheme-relative
 * URLs (`//evil.example`) and backslash variants browsers normalise to '//'
 * (`/\evil.example`). Anything else returns null and the caller falls back to
 * the default route.
 */
export function safeInternalUrl(target: string | null | undefined): string | null {
  if (!target || !target.startsWith('/')) {
    return null;
  }
  if (target.startsWith('//') || target.startsWith('/\\')) {
    return null;
  }
  return target;
}

/**
 * Git commit SHA baked into the Angular bundle at build time.
 *
 * Set via `ng build --define __COGNOS_COMMIT_SHA__='"…"'` (see
 * `frontend/scripts/run-ng-with-commit.mjs` and deploy's `COGNOS_COMMIT_SHA`).
 * Defaults to "unknown" when the define is absent (e.g. some unit-test paths).
 */
declare const __COGNOS_COMMIT_SHA__: string | undefined;

export const APP_COMMIT_SHA: string =
  typeof __COGNOS_COMMIT_SHA__ === 'string' && __COGNOS_COMMIT_SHA__.length > 0
    ? __COGNOS_COMMIT_SHA__
    : 'unknown';

/** HTTP header the API sets on every response (see backend/internal/buildinfo). */
export const API_COMMIT_HEADER = 'X-Cognos-Commit';

/** Short display form for a commit SHA (7 hex chars), or the raw value when short. */
export function shortCommitSha(sha: string | null | undefined): string {
  const value = sha?.trim() ?? '';
  if (!value || value === 'unknown') {
    return 'unknown';
  }
  return value.length > 7 ? value.slice(0, 7) : value;
}

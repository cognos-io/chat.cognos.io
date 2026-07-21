export const environment = {
  isDevelopment: true, // Has to be explicitly enabled
  pocketbaseBaseUrl: 'http://localhost:8090',
  // Base URL of the marketing site, used for in-app links out to legal/trust
  // pages (e.g. /security, /subprocessors). No trailing slash.
  marketingBaseUrl: 'https://cognos.io',
  localVaultPassword: '',
  // Preferred model suggested when a user enables image generation on a model
  // that can't do it. Falls back to the first image-capable eligible model when
  // this id isn't in the catalogue.
  suggestedImageModelId: 'gemini-2-5-flash-image',
  // Paddle.js: client-side token (publishable) + environment. Empty token
  // disables the overlay and falls back to the hosted checkout URL.
  paddleClientToken: 'test_c1107d12db43b5817816135fccf',
  paddleEnvironment: 'sandbox' as 'sandbox' | 'production',
  // Analytics stay off in development: events go to console.debug only
  // (docs/specs/product-analytics.md §1 — zero events from dev environments).
  analytics: {
    enabled: false,
    plausibleDomain: 'app.cognos.io',
    plausibleApiHost: 'https://plausible.io',
  },
  // Build-time feature flags. One per not-yet-shipped settings section; the
  // settings nav hides flagged-off sections and their routes redirect to
  // /account. Flip to true to ship a section (can graduate to per-user later).
  featureFlags: {
    usage: false,
    security: true,
    // Organisations/Teams v1 is shipped in-app, but sales stay limited to
    // selected design partners until the Teams GA gates are complete.
    team: true,
    notifications: false,
    // Encrypted projects — on in development so the shell and e2e can exercise
    // it while phases 2–3 are built.
    projects: true,
  },
};

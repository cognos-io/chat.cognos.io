export const environment = {
  isDevelopment: false, // Has to be explicitly enabled
  pocketbaseBaseUrl: 'https://api.cognos.io',
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
  paddleClientToken: '',
  paddleEnvironment: 'production' as 'sandbox' | 'production',
  // Privacy-respecting product analytics (docs/specs/product-analytics.md).
  // Enabled only in production; events are enums/booleans, never content or
  // identifiers. Dev/e2e log to the console instead.
  analytics: {
    enabled: true,
    plausibleDomain: 'app.cognos.io',
    plausibleApiHost: 'https://plausible.io',
  },
  // Build-time feature flags. One per not-yet-shipped settings section; the
  // settings nav hides flagged-off sections and their routes redirect to
  // /account. Flip to true to ship a section (can graduate to per-user later).
  featureFlags: {
    usage: false,
    // Security & keys: real page (Emergency Kit re-download, password change,
    // two-factor management). Shipped on.
    security: true,
    team: true,
    notifications: false,
    // Encrypted projects (standalone workspaces, no sharing). Shipped on for
    // launch; sharing (phase 2) is a later follow-up.
    projects: true,
  },
};

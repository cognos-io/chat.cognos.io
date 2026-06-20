export const environment = {
  isDevelopment: false, // Has to be explicitly enabled
  pocketbaseBaseUrl: 'https://api.cognos.io',
  localVaultPassword: '',
  // Paddle.js: client-side token (publishable) + environment. Empty token
  // disables the overlay and falls back to the hosted checkout URL.
  paddleClientToken: '',
  paddleEnvironment: 'production' as 'sandbox' | 'production',
  // Build-time feature flags. One per not-yet-shipped settings section; the
  // settings nav hides flagged-off sections and their routes redirect to
  // /account. Flip to true to ship a section (can graduate to per-user later).
  featureFlags: {
    usage: false,
    security: false,
    team: false,
    notifications: false,
    // Encrypted projects (shared workspaces). Off until sharing (phase 2) is
    // complete.
    projects: false,
  },
};

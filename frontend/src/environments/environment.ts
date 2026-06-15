export const environment = {
  isDevelopment: false, // Has to be explicitly enabled
  pocketbaseBaseUrl: 'https://api.cognos.io',
  localVaultPassword: '',
  // Paddle.js: client-side token (publishable) + environment. Empty token
  // disables the overlay and falls back to the hosted checkout URL.
  paddleClientToken: '',
  paddleEnvironment: 'production' as 'sandbox' | 'production',
};

export const environment = {
  isDevelopment: true, // Has to be explicitly enabled
  pocketbaseBaseUrl: 'http://localhost:8090',
  localVaultPassword: '',
  // Paddle.js: client-side token (publishable) + environment. Empty token
  // disables the overlay and falls back to the hosted checkout URL.
  paddleClientToken: '',
  paddleEnvironment: 'sandbox' as 'sandbox' | 'production',
};

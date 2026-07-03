import { environment as developmentEnvironment } from './environment.development';

export const environment = {
  ...developmentEnvironment,
  pocketbaseBaseUrl: globalThis.location?.origin ?? '',
  // Explicitly off (not just inherited) so a future dev-environment change can
  // never turn real analytics on in e2e runs — the analytics e2e spec asserts
  // zero requests to plausible.io.
  analytics: {
    ...developmentEnvironment.analytics,
    enabled: false,
  },
};

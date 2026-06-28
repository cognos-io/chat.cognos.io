import { environment as developmentEnvironment } from './environment.development';

export const environment = {
  ...developmentEnvironment,
  pocketbaseBaseUrl: globalThis.location?.origin ?? '',
};

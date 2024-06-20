import { Injectable, Signal, computed, signal } from '@angular/core';

import { Provider, hardCodedProviders } from '@app/interfaces/provider';

@Injectable({
  providedIn: 'root',
})
export class ProviderService {
  constructor() {}

  private readonly _providers = signal(hardCodedProviders);

  lookupProvider(providerId: string): Signal<Provider | undefined> {
    return computed(() => {
      return this._providers().find((provider) => provider.id === providerId);
    });
  }
}

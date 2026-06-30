import {
  EnvironmentProviders,
  Provider,
  inject,
  provideAppInitializer,
} from '@angular/core';

import { ThemeService } from '@app/services/theme.service';

// provideAppTheme starts the ThemeService during bootstrap so it claims the
// `data-theme`/`color-scheme` attributes, begins listening for OS colour-scheme
// changes, and reconciles the account preference once the user is known.
//
// The very first paint is handled earlier by a tiny inline script in index.html
// (it reads localStorage['cognos:theme'] and sets the attribute before any
// stylesheet applies), so there is no light/dark flash before this runs.
export function provideAppTheme(): (Provider | EnvironmentProviders)[] {
  return [
    provideAppInitializer(() => {
      inject(ThemeService).init();
    }),
  ];
}

import { ApplicationConfig } from '@angular/core';
import { MAT_DIALOG_DEFAULT_OPTIONS } from '@angular/material/dialog';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { IconService } from './services/icon.service';
import { provideOpenAi } from './services/openai.service.provider';
import { providePocketbase } from './services/pocketbase.service.provider';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideAnimationsAsync(),
    providePocketbase(),
    provideOpenAi(),
    IconService,
    {
      provide: MAT_DIALOG_DEFAULT_OPTIONS,
      useValue: { backdropClass: 'backdrop-blur', width: '600px' },
    },
  ],
};

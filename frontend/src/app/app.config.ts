import { provideHttpClient } from '@angular/common/http';
import { ApplicationConfig } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';

import { provideMarkdown } from 'ngx-markdown';

import { routes } from './app.routes';
import { provideOpenAi } from './services/openai.service.provider';
import { providePocketbase } from './services/pocketbase.service.provider';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(),
    provideMarkdown(),
    providePocketbase(),
    provideOpenAi(),
  ],
};

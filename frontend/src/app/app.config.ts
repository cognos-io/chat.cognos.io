import { provideHttpClient } from '@angular/common/http';
import { ApplicationConfig } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';

import markedAlert from 'marked-alert';
import markedFootnote from 'marked-footnote';
import { MARKED_EXTENSIONS, SANITIZE, provideMarkdown } from 'ngx-markdown';

import { routes } from './app.routes';
import { provideAppI18n } from './i18n/transloco.providers';
import { sanitizeMarkdown } from './markdown/sanitize-markdown';
import { provideAnalytics } from './services/analytics/analytics.providers';
import { providePocketbase } from './services/pocketbase.service.provider';
import { provideAppTheme } from './theme/theme.providers';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(),
    provideMarkdown({
      sanitize: { provide: SANITIZE, useValue: sanitizeMarkdown },
      // GitHub/Obsidian-flavoured syntax that LLMs commonly emit. GFM task
      // lists, tables and strikethrough already ship with marked.
      markedExtensions: [
        { provide: MARKED_EXTENSIONS, useValue: markedAlert(), multi: true },
        { provide: MARKED_EXTENSIONS, useValue: markedFootnote(), multi: true },
      ],
    }),
    providePocketbase(),
    ...provideAnalytics(),
    ...provideAppI18n(),
    ...provideAppTheme(),
  ],
};

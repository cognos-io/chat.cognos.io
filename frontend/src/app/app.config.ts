import { provideHttpClient } from '@angular/common/http';
import { ApplicationConfig } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';

import DOMPurify from 'dompurify';
import markedAlert from 'marked-alert';
import markedFootnote from 'marked-footnote';
import { MARKED_EXTENSIONS, SANITIZE, provideMarkdown } from 'ngx-markdown';

import { routes } from './app.routes';
import { providePocketbase } from './services/pocketbase.service.provider';

// Angular's built-in HTML sanitizer strips elements that GitHub/Obsidian
// markdown relies on (task-list checkboxes, callout SVG icons, footnote
// anchors). DOMPurify keeps a vetted allowlist for those while still removing
// scripts, event handlers and unsafe URLs from untrusted model output.
const sanitizeMarkdown = (html: string): string =>
  DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, svg: true, mathMl: true },
  });

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
  ],
};

import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import { Translation, TranslocoLoader } from '@jsverse/transloco';

// Loads a language catalog from the static assets bundle. Catalogs are plain
// JSON shipped alongside the app, so a single GET per language (cached by the
// browser) is all that's needed; Transloco caches the parsed result in memory.
@Injectable({ providedIn: 'root' })
export class TranslocoHttpLoader implements TranslocoLoader {
  private readonly _http = inject(HttpClient);

  getTranslation(lang: string) {
    return this._http.get<Translation>(`/assets/i18n/${lang}.json`);
  }
}

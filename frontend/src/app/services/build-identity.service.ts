import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';

import { catchError, of } from 'rxjs';

import { API_COMMIT_HEADER, APP_COMMIT_SHA, shortCommitSha } from '@app/build-info';

import { environment } from '@environments/environment';

interface HealthResponse {
  is_database_connected?: boolean;
  commit?: string;
}

/**
 * Surfaces the commit SHA baked into this SPA bundle alongside the commit the
 * API reports (via GET /health JSON and/or X-Cognos-Commit). Used on Account
 * so operators can spot a partial FE/API deploy.
 */
@Injectable({ providedIn: 'root' })
export class BuildIdentityService {
  private readonly _http = inject(HttpClient);
  private readonly _apiCommit = signal<string | null>(null);
  private readonly _apiCommitLoaded = signal(false);

  /** Commit SHA compiled into the Angular assets. */
  readonly appCommit = APP_COMMIT_SHA;

  /** Commit SHA reported by the API, or null until the first successful probe. */
  readonly apiCommit = this._apiCommit.asReadonly();

  readonly appCommitShort = shortCommitSha(this.appCommit);

  readonly apiCommitShort = computed(() => shortCommitSha(this._apiCommit()));

  readonly commitsMismatch = computed(() => {
    const api = this._apiCommit();
    if (!api || !this._apiCommitLoaded()) {
      return false;
    }
    if (api === 'unknown' || this.appCommit === 'unknown') {
      return false;
    }
    return api !== this.appCommit;
  });

  /** Fetch /health and record the API commit (body preferred, then header). */
  refreshApiCommit(): void {
    this._http
      .get<HealthResponse>(`${environment.pocketbaseBaseUrl}/health`, {
        observe: 'response',
      })
      .pipe(catchError(() => of(null)))
      .subscribe((res) => {
        if (!res) {
          return;
        }
        const fromBody = res.body?.commit?.trim();
        const fromHeader = res.headers.get(API_COMMIT_HEADER)?.trim();
        const commit = fromBody || fromHeader;
        if (commit) {
          this._apiCommit.set(commit);
          this._apiCommitLoaded.set(true);
        }
      });
  }
}

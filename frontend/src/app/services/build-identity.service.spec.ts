import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { API_COMMIT_HEADER } from '@app/build-info';

import { environment } from '@environments/environment';

import { BuildIdentityService } from './build-identity.service';

describe('BuildIdentityService', () => {
  let service: BuildIdentityService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(BuildIdentityService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('records the API commit from the /health JSON body', () => {
    service.refreshApiCommit();

    const req = http.expectOne(`${environment.pocketbaseBaseUrl}/health`);
    expect(req.request.method).toBe('GET');
    req.flush(
      { is_database_connected: true, commit: 'api-commit-sha-full' },
      { status: 200, statusText: 'OK' },
    );

    expect(service.apiCommit()).toBe('api-commit-sha-full');
    expect(service.apiCommitShort()).toBe('api-com');
  });

  it('falls back to the X-Cognos-Commit header when the body omits commit', () => {
    service.refreshApiCommit();

    const req = http.expectOne(`${environment.pocketbaseBaseUrl}/health`);
    req.flush(
      { is_database_connected: true },
      {
        status: 200,
        statusText: 'OK',
        headers: { [API_COMMIT_HEADER]: 'header-only-commit-sha' },
      },
    );

    expect(service.apiCommit()).toBe('header-only-commit-sha');
  });

  it('leaves apiCommit null when /health fails', () => {
    service.refreshApiCommit();

    const req = http.expectOne(`${environment.pocketbaseBaseUrl}/health`);
    req.flush('nope', { status: 500, statusText: 'Server Error' });

    expect(service.apiCommit()).toBeNull();
    expect(service.commitsMismatch()).toBe(false);
  });
});

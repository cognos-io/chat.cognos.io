import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';

import { Observable, firstValueFrom, of } from 'rxjs';

import { AuthService } from '@app/services/auth.service';

import { authGuard } from './auth.guard';

// Pins the deep-link contract: a signed-out visit to a guarded URL (the
// walkthrough case was an /invite?token=… link) must arrive on the login page
// with the FULL attempted URL — path and query — preserved as ?next=… so the
// user lands back on it after signing in.
describe('authGuard', () => {
  function runGuard(user: unknown, url: string): Promise<boolean | UrlTree> {
    TestBed.configureTestingModule({
      providers: [{ provide: AuthService, useValue: { user$: of(user) } }],
    });
    const result$ = TestBed.runInInjectionContext(() =>
      authGuard({} as never, { url } as never),
    ) as Observable<boolean | UrlTree>;
    return firstValueFrom(result$);
  }

  it('lets a signed-in user through', async () => {
    await expect(runGuard({ id: 'user_1' }, '/invite?token=abc')).resolves.toBe(true);
  });

  it('redirects a signed-out user to login with the full URL as next', async () => {
    const result = await runGuard(null, '/invite?token=abc');

    expect(result).toBeInstanceOf(UrlTree);
    const tree = result as UrlTree;
    expect(tree.queryParams['next']).toBe('/invite?token=abc');

    const serialized = TestBed.inject(Router).serializeUrl(tree);
    expect(serialized).toBe('/auth/login?next=%2Finvite%3Ftoken%3Dabc');
  });

  it('adds no next parameter for the default route', async () => {
    const result = await runGuard(null, '/');

    expect(result).toBeInstanceOf(UrlTree);
    const tree = result as UrlTree;
    expect(tree.queryParams).toEqual({});
    expect(TestBed.inject(Router).serializeUrl(tree)).toBe('/auth/login');
  });
});

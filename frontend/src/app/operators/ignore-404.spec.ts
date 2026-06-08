import { ClientResponseError } from 'pocketbase';

import { firstValueFrom, lastValueFrom, of, throwError, toArray } from 'rxjs';

import { describe, expect, it } from 'vitest';

import { ignorePocketbase404 } from './ignore-404';

describe('ignorePocketbase404', () => {
  it('passes successful emissions through unchanged', async () => {
    const values = await firstValueFrom(
      of(1, 2, 3).pipe(ignorePocketbase404(), toArray()),
    );
    expect(values).toEqual([1, 2, 3]);
  });

  it('swallows ClientResponseError 404s as EMPTY', async () => {
    const error = new ClientResponseError({ status: 404, data: { message: 'gone' } });
    const values = await lastValueFrom(
      throwError(() => error).pipe(ignorePocketbase404(), toArray()),
    );
    expect(values).toEqual([]);
  });

  it('swallows plain shape-matching 404s as EMPTY', async () => {
    // Some PocketBase wrappers throw shape-matching plain errors rather than
    // the formal ClientResponseError. The operator must accept those too.
    const values = await lastValueFrom(
      throwError(() => ({ status: 404 })).pipe(ignorePocketbase404(), toArray()),
    );
    expect(values).toEqual([]);
  });

  it('rethrows non-404 ClientResponseError so callers see real failures', async () => {
    const error = new ClientResponseError({ status: 500, data: { message: 'boom' } });

    await expect(
      firstValueFrom(throwError(() => error).pipe(ignorePocketbase404())),
    ).rejects.toBe(error);
  });

  it('rethrows plain errors without a status', async () => {
    const error = new Error('network down');

    await expect(
      firstValueFrom(throwError(() => error).pipe(ignorePocketbase404())),
    ).rejects.toBe(error);
  });

  it('rethrows shape-matching errors with non-404 statuses', async () => {
    const error = { status: 403, message: 'forbidden' };

    await expect(
      firstValueFrom(throwError(() => error).pipe(ignorePocketbase404())),
    ).rejects.toBe(error);
  });
});

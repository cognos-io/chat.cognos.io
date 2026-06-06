import { ClientResponseError } from 'pocketbase';

import { EMPTY, Observable, catchError, throwError } from 'rxjs';

export const ignorePocketbase404 = <T>() => {
  return function (source: Observable<T>): Observable<T> {
    return source.pipe(
      catchError((error: { status?: number }) => {
        if (error instanceof ClientResponseError && error.status === 404) {
          return EMPTY;
        }
        if (error?.status === 404) {
          return EMPTY;
        }
        return throwError(() => error);
      }),
    );
  };
};

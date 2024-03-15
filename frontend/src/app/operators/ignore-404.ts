import { ClientResponseError } from 'pocketbase';

import { EMPTY, Observable, catchError, throwError } from 'rxjs';

export const ignorePocketbase404 = <T>() => {
  return function (source: Observable<T>): Observable<T> {
    return source.pipe(
      catchError((error) => {
        if (error instanceof ClientResponseError) {
          if (error.status === 404) {
            return EMPTY;
          }
        }
        return throwError(() => error);
      }),
    );
  };
};

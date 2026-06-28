import { DestroyRef, Signal, afterNextRender, inject, signal } from '@angular/core';

/** The viewport width below which modals render as bottom sheets. */
export const MOBILE_BREAKPOINT_QUERY = '(max-width: 600px)';

/**
 * A reactive flag for the mobile / sheet breakpoint. Browser-only: it stays
 * `false` during SSR and starts observing once the view renders. Call from an
 * injection context (a field initializer or constructor).
 *
 * Used to make sheet footer buttons full-width on mobile (the desktop modal keeps
 * them inline).
 */
export function injectIsMobile(): Signal<boolean> {
  const isMobile = signal(false);
  const destroyRef = inject(DestroyRef);

  afterNextRender(() => {
    // Guard environments without matchMedia (jsdom unit tests, older runtimes).
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const query = window.matchMedia(MOBILE_BREAKPOINT_QUERY);
    isMobile.set(query.matches);
    const onChange = (event: MediaQueryListEvent): void => isMobile.set(event.matches);
    query.addEventListener('change', onChange);
    destroyRef.onDestroy(() => query.removeEventListener('change', onChange));
  });

  return isMobile.asReadonly();
}

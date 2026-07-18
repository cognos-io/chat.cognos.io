import { Route } from '@angular/router';

import { describe, expect, it } from 'vitest';

import en from '../assets/i18n/en.json';
import { routes } from './app.routes';

// findRoute walks the route tree depth-first and returns the first route
// whose path matches.
function findRoute(candidates: Route[] | undefined, path: string): Route | undefined {
  for (const route of candidates ?? []) {
    if (route.path === path) {
      return route;
    }
    const child = findRoute(route.children, path);
    if (child) {
      return child;
    }
  }
  return undefined;
}

describe('app routes', () => {
  // Pin (issue m2): the /account/team page called itself three different
  // things — nav "Team & sharing", page heading "Team", browser title
  // "Team & sharing". One name everywhere: "Team".
  describe('/account/team naming', () => {
    it('uses the page heading as the route (document) title', () => {
      const team = findRoute(routes, 'team');
      expect(team).toBeDefined();
      expect(team?.data?.['title']).toBe(en.team.title);
      expect(en.team.title).toBe('Team');
    });

    it('names the settings nav entry the same as the page heading', () => {
      // settings.nav.team labels the sidebar link to /account/team
      // (settings-shell.component.ts); it must read exactly like the page it
      // opens. Cross-locale parity (de/fr/es/pt/it) is enforced by
      // i18n/translation-parity.spec.ts key checks plus the catalogue review.
      expect(en.settings.nav.team).toBe(en.team.title);
    });
  });
});

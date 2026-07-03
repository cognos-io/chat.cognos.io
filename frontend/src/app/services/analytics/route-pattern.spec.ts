import { ActivatedRouteSnapshot } from '@angular/router';

import { describe, expect, it } from 'vitest';

import { routePattern } from './route-pattern';

// Minimal structural stand-in for an ActivatedRouteSnapshot chain. Only the
// fields routePattern() reads are modelled.
interface FakeSnapshot {
  routeConfig: { path?: string } | null;
  url: { path: string }[];
  firstChild: FakeSnapshot | null;
}

function chain(
  nodes: { path?: string | null; urlSegments?: string[] }[],
): ActivatedRouteSnapshot {
  // The root snapshot never has a routeConfig; children follow.
  const root: FakeSnapshot = { routeConfig: null, url: [], firstChild: null };
  let parent = root;
  for (const node of nodes) {
    const child: FakeSnapshot = {
      routeConfig: node.path === null ? null : { path: node.path },
      url: (node.urlSegments ?? []).map((path) => ({ path })),
      firstChild: null,
    };
    parent.firstChild = child;
    parent = child;
  }
  return root as unknown as ActivatedRouteSnapshot;
}

describe('routePattern', () => {
  const cases: {
    name: string;
    root: ActivatedRouteSnapshot;
    expected: string;
  }[] = [
    // Sunny: parameterised chat route reports its pattern, not the id.
    {
      name: 'conversation route reports the :conversationId pattern',
      root: chain([
        { path: '', urlSegments: [] },
        { path: 'c/:conversationId', urlSegments: ['c', 'abc123xyz'] },
      ]),
      expected: '/c/:conversationId',
    },
    // Edge: nested settings route with a parameterised child.
    {
      name: 'nested project route keeps every config segment',
      root: chain([
        { path: 'account', urlSegments: ['account'] },
        { path: 'projects/:projectId', urlSegments: ['projects', 'p42'] },
      ]),
      expected: '/account/projects/:projectId',
    },
    // Edge: public share token never appears.
    {
      name: 'public share route reports the :token pattern',
      root: chain([{ path: 'p/:token', urlSegments: ['p', '8f3ksecrettoken'] }]),
      expected: '/p/:token',
    },
    // Edge: empty-path parents are skipped, root is '/'.
    {
      name: 'root route with empty-path children is /',
      root: chain([
        { path: '', urlSegments: [] },
        { path: '', urlSegments: [] },
      ]),
      expected: '/',
    },
    {
      name: 'bare root snapshot is /',
      root: chain([]),
      expected: '/',
    },
    {
      name: 'auth child routes join with /',
      root: chain([
        { path: 'auth', urlSegments: ['auth'] },
        { path: 'login', urlSegments: ['login'] },
      ]),
      expected: '/auth/login',
    },
    // Rainy: wildcards and unmatched segments must never leak the raw URL.
    {
      name: 'wildcard route falls back to /unknown',
      root: chain([{ path: '**', urlSegments: ['no-such-page'] }]),
      expected: '/unknown',
    },
    {
      name: 'URL segments without a routeConfig fall back to /unknown',
      root: chain([{ path: null, urlSegments: ['mystery', 'secret-id'] }]),
      expected: '/unknown',
    },
  ];

  it.each(cases)('$name', ({ root, expected }) => {
    expect(routePattern(root)).toBe(expected);
  });

  it('never returns a raw url segment for parameterised routes', () => {
    const root = chain([
      { path: 'c/:conversationId', urlSegments: ['c', 'realconvid123'] },
    ]);
    expect(routePattern(root)).not.toContain('realconvid123');
  });
});

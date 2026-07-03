import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ANALYTICS_CONFIG,
  ANALYTICS_FETCH,
  Analytics,
  AnalyticsConfig,
  signupSource,
} from './analytics';
import { provideAnalytics } from './analytics.providers';
import { ConsoleAnalytics } from './console-analytics';
import { PlausibleAnalytics } from './plausible-analytics';

const config = (enabled: boolean): AnalyticsConfig => ({
  enabled,
  domain: 'app.cognos.io',
  apiHost: 'https://plausible.example',
});

describe('provideAnalytics', () => {
  it.each([
    { enabled: false, expected: ConsoleAnalytics, name: 'ConsoleAnalytics' },
    { enabled: true, expected: PlausibleAnalytics, name: 'PlausibleAnalytics' },
  ])('resolves $name when enabled is $enabled', ({ enabled, expected }) => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        ...provideAnalytics(),
        { provide: ANALYTICS_CONFIG, useValue: config(enabled) },
        { provide: ANALYTICS_FETCH, useValue: vi.fn(() => Promise.resolve()) },
      ],
    });

    expect(TestBed.inject(Analytics)).toBeInstanceOf(expected);
  });

  it('sends a sanitised route-pattern pageview on navigation', async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(new Response()));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'c/:conversationId', children: [] }]),
        ...provideAnalytics(),
        { provide: ANALYTICS_CONFIG, useValue: config(true) },
        { provide: ANALYTICS_FETCH, useValue: fetchSpy },
      ],
    });

    // Injecting anything runs the environment initializer wiring.
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/c/real-conversation-id');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      name: string;
      url: string;
      domain: string;
    };
    expect(body.name).toBe('pageview');
    expect(body.domain).toBe('app.cognos.io');
    expect(body.url).toBe('https://app.cognos.io/c/:conversationId');
    expect(body.url).not.toContain('real-conversation-id');
  });
});

describe('PlausibleAnalytics', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  const build = (fetchImpl: ReturnType<typeof vi.fn>): PlausibleAnalytics => {
    TestBed.configureTestingModule({
      providers: [
        { provide: ANALYTICS_CONFIG, useValue: config(true) },
        { provide: ANALYTICS_FETCH, useValue: fetchImpl },
      ],
    });
    return TestBed.inject(PlausibleAnalytics);
  };

  beforeEach(() => {
    fetchSpy = vi.fn(() => Promise.resolve(new Response()));
  });

  it('POSTs the event with domain, name, pattern url and props', () => {
    const analytics = build(fetchSpy);
    analytics.page('/pricing');
    analytics.track('checkout_started', { plan: 'payg', entry: 'pricing' });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const [url, init] = fetchSpy.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe('https://plausible.example/api/event');
    expect(init.keepalive).toBe(true);
    expect(JSON.parse(init.body as string)).toEqual({
      domain: 'app.cognos.io',
      name: 'checkout_started',
      url: 'https://app.cognos.io/pricing',
      props: { plan: 'payg', entry: 'pricing' },
    });
  });

  it('never throws when fetch rejects', async () => {
    const failing = vi.fn(() => Promise.reject(new Error('network down')));
    const analytics = build(failing);

    expect(() => analytics.track('conversation_created')).not.toThrow();
    expect(() => analytics.page('/')).not.toThrow();

    // Let the swallowed rejections settle; an unhandled rejection would fail
    // the test run.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it('never throws when fetch itself throws synchronously', () => {
    const throwing = vi.fn(() => {
      throw new Error('fetch unavailable');
    });
    const analytics = build(throwing);
    expect(() => analytics.track('conversation_created')).not.toThrow();
  });
});

describe('signupSource', () => {
  it.each([
    { ref: null, expected: 'direct' },
    { ref: 'hero', expected: 'hero' },
    { ref: 'pricing_business', expected: 'pricing_business' },
    { ref: 'totally-made-up', expected: 'other' },
    { ref: 'user@example.com', expected: 'other' },
  ])('maps ref $ref to $expected', ({ ref, expected }) => {
    expect(signupSource(ref)).toBe(expected);
  });
});

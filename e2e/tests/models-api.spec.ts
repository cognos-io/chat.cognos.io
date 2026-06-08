import { expect, test } from '@playwright/test';

import { newAnonymousApi, provisionApiUser } from './api-helpers';

interface ModelEntry {
  id: string;
  name: string;
  slug: string;
  provider_id: string;
  description: string;
  privacy_tier: string;
  content_types: string[];
  input_context_tokens: number;
  max_output_tokens?: number;
  pricing: {
    input_usd_per_million_tokens: number;
    output_usd_per_million_tokens: number;
  };
  is_eligible: boolean;
  ineligibility_reason?: string;
  // Internal routing fields that MUST NOT appear in the response. Declaring
  // them here is purely a typed assertion against accidental leaks; runtime
  // checks below verify the keys are actually absent.
  provider_model_id?: never;
  base_url?: never;
  api_key?: never;
}

interface ModelsResponse {
  privacy_tier: string;
  preferred_model_id?: string;
  models: ModelEntry[];
}

test.describe('models catalogue API', () => {
  test('unauthenticated callers cannot read the catalogue', async () => {
    const api = await newAnonymousApi();
    try {
      const res = await api.get('/api/v1/models');
      expect(res.status()).toBe(401);
    } finally {
      await api.dispose();
    }
  });

  test('authenticated user receives a typed catalogue with eligibility metadata', async () => {
    const user = await provisionApiUser();
    try {
      const res = await user.api.get('/api/v1/models');
      expect(res.ok(), `models: ${res.status()} ${await res.text()}`).toBe(true);
      const body = (await res.json()) as ModelsResponse;

      // Privacy tier must always be one of the documented values; the
      // backend defaults missing/invalid tiers to a known fallback rather
      // than echoing whatever was on the user row.
      expect(['ch_only', 'eu', 'global']).toContain(body.privacy_tier);

      // The active catalogue is curated and short — at least one approved
      // entry must exist for any tier we support.
      expect(body.models.length).toBeGreaterThan(0);

      for (const model of body.models) {
        // Required, structurally significant fields the frontend depends
        // on for selection + display.
        expect(model.id).toBeTruthy();
        expect(model.name).toBeTruthy();
        expect(model.slug).toBeTruthy();
        expect(model.provider_id).toBeTruthy();
        expect(typeof model.input_context_tokens).toBe('number');
        expect(typeof model.is_eligible).toBe('boolean');
        expect(model.pricing).toBeTruthy();
        expect(typeof model.pricing.input_usd_per_million_tokens).toBe('number');
        expect(typeof model.pricing.output_usd_per_million_tokens).toBe('number');
        expect(Array.isArray(model.content_types)).toBe(true);
      }
    } finally {
      await user.api.dispose();
    }
  });

  test('catalogue response never leaks provider routing fields', async () => {
    // Locks the contract that the public models endpoint never returns
    // provider model IDs, base URLs, or API keys — those are internal
    // routing details that must stay on the server. Treat any future
    // re-leak as a hard regression.
    const user = await provisionApiUser();
    try {
      const res = await user.api.get('/api/v1/models');
      expect(res.ok()).toBe(true);
      const raw = await res.text();

      for (const forbidden of ['provider_model_id', 'base_url', 'api_key']) {
        expect(
          raw.includes(forbidden),
          `models response leaked "${forbidden}": ${raw}`,
        ).toBe(false);
      }
    } finally {
      await user.api.dispose();
    }
  });

  test('a user with no preferred model gets the field omitted, not nulled', async () => {
    // Fresh users have no preferred_model_id. The Go handler emits the
    // field with `omitempty`, so the JSON should not carry a null key —
    // matching what TypeScript clients expect from `preferred_model_id?`.
    const user = await provisionApiUser();
    try {
      const res = await user.api.get('/api/v1/models');
      const raw = await res.text();
      expect(raw.includes('"preferred_model_id":null')).toBe(false);
    } finally {
      await user.api.dispose();
    }
  });
});

import { describe, expect, it } from 'vitest';

import { Model } from '@app/interfaces/model';

import {
  EMPTY_MODEL_CAPABILITY_METADATA,
  ModelCapabilityMetadata,
} from './model-capability-metadata';
import {
  LONG_CONTEXT_THRESHOLD,
  RECENT_MODELS_LIMIT,
  addRecentModel,
  buildSearchSynonyms,
  flattenGroups,
  isLongContextModel,
  isLowCostModel,
  isReasoningModel,
  matchesQuickFilter,
  modelMatchesSearch,
  normalizeSearchText,
  orderModels,
  resolveDefaultModel,
} from './model-discovery';

// makeModel builds a Model fixture with sensible eligible defaults so each test
// overrides only the fields it cares about.
function makeModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'model-a',
    name: 'Model A',
    slug: 'model-a',
    providerId: 'requesty',
    providerName: 'Requesty',
    description: 'A general purpose model.',
    privacyTier: 'eu',
    tags: [],
    contentTypes: ['text'],
    inputContextLength: 8_192,
    pricing: { inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 1 },
    supportsImageGeneration: false,
    reasoningEfforts: [],
    isEligible: true,
    ...overrides,
  };
}

// metaFor builds a metadata lookup from a partial map keyed by model id.
function metaFor(
  map: Record<string, Partial<ModelCapabilityMetadata>>,
): (id: string) => ModelCapabilityMetadata {
  return (id) => ({ ...EMPTY_MODEL_CAPABILITY_METADATA, ...(map[id] ?? {}) });
}

describe('normalizeSearchText', () => {
  it('lowercases, trims and collapses whitespace', () => {
    expect(normalizeSearchText('  Hello   World  ')).toBe('hello world');
  });

  it('strips diacritics across supported languages', () => {
    expect(normalizeSearchText('Günstig')).toBe('gunstig');
    expect(normalizeSearchText('rápido')).toBe('rapido');
    expect(normalizeSearchText('raciocínio')).toBe('raciocinio');
    expect(normalizeSearchText('Zürich')).toBe('zurich');
  });
});

describe('capability predicates', () => {
  it('detects reasoning by declared effort tiers', () => {
    expect(isReasoningModel(makeModel({ reasoningEfforts: [] }))).toBe(false);
    expect(isReasoningModel(makeModel({ reasoningEfforts: ['low', 'high'] }))).toBe(
      true,
    );
  });

  it('detects low cost via the cost tier', () => {
    expect(
      isLowCostModel(
        makeModel({
          pricing: { inputUsdPerMillionTokens: 0.2, outputUsdPerMillionTokens: 0.2 },
        }),
      ),
    ).toBe(true);
    expect(
      isLowCostModel(
        makeModel({
          pricing: { inputUsdPerMillionTokens: 15, outputUsdPerMillionTokens: 75 },
        }),
      ),
    ).toBe(false);
  });

  it('detects long context at the documented threshold', () => {
    expect(
      isLongContextModel(makeModel({ inputContextLength: LONG_CONTEXT_THRESHOLD })),
    ).toBe(true);
    expect(
      isLongContextModel(makeModel({ inputContextLength: LONG_CONTEXT_THRESHOLD - 1 })),
    ).toBe(false);
  });
});

describe('matchesQuickFilter', () => {
  const meta = metaFor({
    'rec-1': { recommended: true },
    'fast-1': { fast: true },
    'pow-1': { powerful: true },
  });

  it('matches everything when no filter is active', () => {
    expect(matchesQuickFilter(makeModel(), null, meta)).toBe(true);
  });

  it('uses curated metadata for recommended/fast/powerful', () => {
    expect(matchesQuickFilter(makeModel({ id: 'rec-1' }), 'recommended', meta)).toBe(
      true,
    );
    expect(matchesQuickFilter(makeModel({ id: 'fast-1' }), 'fast', meta)).toBe(true);
    expect(matchesQuickFilter(makeModel({ id: 'pow-1' }), 'powerful', meta)).toBe(true);
    expect(matchesQuickFilter(makeModel({ id: 'rec-1' }), 'fast', meta)).toBe(false);
  });

  it('uses public metadata for image/reasoning/long context/low cost', () => {
    expect(
      matchesQuickFilter(makeModel({ supportsImageGeneration: true }), 'image', meta),
    ).toBe(true);
    expect(
      matchesQuickFilter(makeModel({ reasoningEfforts: ['low'] }), 'reasoning', meta),
    ).toBe(true);
    expect(
      matchesQuickFilter(
        makeModel({ inputContextLength: 200_000 }),
        'long_context',
        meta,
      ),
    ).toBe(true);
  });
});

describe('modelMatchesSearch', () => {
  it('matches an empty query against every model', () => {
    expect(modelMatchesSearch(makeModel(), '')).toBe(true);
    expect(modelMatchesSearch(makeModel(), '   ')).toBe(true);
  });

  it('matches by name, provider and hosting, case/diacritic insensitively', () => {
    const model = makeModel({
      name: 'Cognos Sovereign',
      providerName: 'Infomaniak',
      hostingCountry: 'Zürich',
    });
    expect(modelMatchesSearch(model, 'sovereign')).toBe(true);
    expect(modelMatchesSearch(model, 'infomaniak')).toBe(true);
    expect(modelMatchesSearch(model, 'zurich')).toBe(true);
  });

  it('matches derived capability words', () => {
    const image = makeModel({ supportsImageGeneration: true });
    expect(modelMatchesSearch(image, 'vision')).toBe(true);
    const reasoning = makeModel({ reasoningEfforts: ['high'] });
    expect(modelMatchesSearch(reasoning, 'reasoning')).toBe(true);
  });

  it('expands synonyms (budget -> low cost)', () => {
    const cheap = makeModel({
      pricing: { inputUsdPerMillionTokens: 0.1, outputUsdPerMillionTokens: 0.1 },
    });
    // "budget" is not in the haystack on its own; the synonym maps it to the
    // indexed "low cost" anchor. ("cheap" is already indexed for low-cost rows.)
    const synonyms = { budget: ['low cost'] };
    expect(modelMatchesSearch(cheap, 'budget', { synonyms })).toBe(true);
    expect(modelMatchesSearch(cheap, 'budget')).toBe(false);
  });

  it('requires all tokens to match (AND semantics)', () => {
    const model = makeModel({ name: 'Claude Opus', providerName: 'Requesty' });
    expect(modelMatchesSearch(model, 'claude requesty')).toBe(true);
    expect(modelMatchesSearch(model, 'claude google')).toBe(false);
  });

  it('matches a localised synonym via NFD folding', () => {
    const cheap = makeModel({
      pricing: { inputUsdPerMillionTokens: 0.1, outputUsdPerMillionTokens: 0.1 },
    });
    // German "günstig" -> low cost; the query is folded before lookup.
    const synonyms = { gunstig: ['low cost'] };
    expect(modelMatchesSearch(cheap, 'günstig', { synonyms })).toBe(true);
  });

  it('matches privacy/swiss searches against Swiss-hosted models', () => {
    const swiss = makeModel({ privacyTier: 'ch_only', hostingCountry: 'CH' });
    expect(modelMatchesSearch(swiss, 'private')).toBe(true);
    expect(modelMatchesSearch(swiss, 'swiss')).toBe(true);
  });
});

describe('buildSearchSynonyms', () => {
  it('expands localised intent terms to English anchors, NFD-folded', () => {
    const synonyms = buildSearchSynonyms({
      lowCost: 'günstig billig',
      private: 'privat schweiz',
      unknownIntent: 'ignored',
    });
    expect(synonyms['gunstig']).toEqual(['low cost']);
    expect(synonyms['billig']).toEqual(['low cost']);
    expect(synonyms['schweiz']).toEqual(['private']);
    // Intents without a known anchor are dropped.
    expect(synonyms['ignored']).toBeUndefined();
  });

  it('drives a localised search end-to-end', () => {
    const cheap = makeModel({
      pricing: { inputUsdPerMillionTokens: 0.1, outputUsdPerMillionTokens: 0.1 },
    });
    const synonyms = buildSearchSynonyms({ lowCost: 'günstig billig preiswert' });
    expect(modelMatchesSearch(cheap, 'preiswert', { synonyms })).toBe(true);
  });
});

describe('orderModels', () => {
  const models = [
    makeModel({ id: 'a', name: 'Alpha' }),
    makeModel({ id: 'b', name: 'Bravo' }),
    makeModel({ id: 'c', name: 'Charlie' }),
    makeModel({ id: 'd', name: 'Delta' }),
  ];
  const meta = metaFor({ c: { recommended: true } });

  function groupMap(groups: ReturnType<typeof orderModels>) {
    return Object.fromEntries(groups.map((g) => [g.key, g.models.map((m) => m.id)]));
  }

  it('partitions into pinned, recent, recommended, other without duplicates', () => {
    const groups = orderModels({
      models,
      pinnedIds: ['b'],
      recentIds: ['d', 'b'],
      hiddenIds: [],
      meta,
    });
    expect(groupMap(groups)).toEqual({
      pinned: ['b'],
      recent: ['d'], // b already pinned, not duplicated
      recommended: ['c'],
      other: ['a'],
    });
  });

  it('removes hidden models unless showHidden is set', () => {
    const hidden = orderModels({
      models,
      pinnedIds: [],
      recentIds: [],
      hiddenIds: ['a'],
      meta,
    });
    expect(flattenGroups(hidden).map((m) => m.id)).not.toContain('a');

    const shown = orderModels({
      models,
      pinnedIds: [],
      recentIds: [],
      hiddenIds: ['a'],
      showHidden: true,
      meta,
    });
    expect(flattenGroups(shown).map((m) => m.id)).toContain('a');
  });

  it('applies the required capability filter', () => {
    const withImage = [
      ...models,
      makeModel({ id: 'img', supportsImageGeneration: true }),
    ];
    const groups = orderModels({
      models: withImage,
      pinnedIds: [],
      recentIds: [],
      hiddenIds: [],
      requiredCapability: 'image_generation',
      meta,
    });
    expect(flattenGroups(groups).map((m) => m.id)).toEqual(['img']);
  });

  it('applies quick filter and search together', () => {
    const groups = orderModels({
      models,
      pinnedIds: [],
      recentIds: [],
      hiddenIds: [],
      quickFilter: 'recommended',
      query: 'charlie',
      meta,
    });
    expect(flattenGroups(groups).map((m) => m.id)).toEqual(['c']);
  });

  it('keeps ineligible models in the list (shown disabled by the UI)', () => {
    const withIneligible = [...models, makeModel({ id: 'locked', isEligible: false })];
    const groups = orderModels({
      models: withIneligible,
      pinnedIds: [],
      recentIds: [],
      hiddenIds: [],
      meta,
    });
    expect(flattenGroups(groups).map((m) => m.id)).toContain('locked');
  });
});

describe('resolveDefaultModel', () => {
  const models = [
    makeModel({ id: 'session' }),
    makeModel({ id: 'project' }),
    makeModel({ id: 'user' }),
    makeModel({ id: 'rec-chat' }),
    makeModel({ id: 'rec-image', supportsImageGeneration: true }),
    makeModel({ id: 'first' }),
  ];
  const meta = metaFor({
    'rec-chat': { recommended: true, recommendedDefaultFor: ['chat'] },
    'rec-image': { recommended: true, recommendedDefaultFor: ['image'] },
  });

  it('prefers the session pick, then project, then user default', () => {
    expect(
      resolveDefaultModel({
        models,
        sessionSelectedId: 'session',
        projectDefaultId: 'project',
        userDefaultId: 'user',
        meta,
      })?.id,
    ).toBe('session');

    expect(
      resolveDefaultModel({
        models,
        projectDefaultId: 'project',
        userDefaultId: 'user',
        meta,
      })?.id,
    ).toBe('project');

    expect(resolveDefaultModel({ models, userDefaultId: 'user', meta })?.id).toBe(
      'user',
    );
  });

  it('falls through a hidden or ineligible default to the recommendation', () => {
    expect(
      resolveDefaultModel({
        models,
        userDefaultId: 'user',
        hiddenIds: ['user'],
        meta,
      })?.id,
    ).toBe('rec-chat');
  });

  it('is purpose-aware: image tool prefers an image recommendation', () => {
    expect(
      resolveDefaultModel({
        models,
        requiredCapability: 'image_generation',
        meta,
      })?.id,
    ).toBe('rec-image');
  });

  it('falls back to the first eligible visible model when nothing is recommended', () => {
    const plain = [
      makeModel({ id: 'x', isEligible: false }),
      makeModel({ id: 'y' }),
      makeModel({ id: 'z' }),
    ];
    expect(resolveDefaultModel({ models: plain })?.id).toBe('y');
  });

  it('returns undefined when no eligible model exists', () => {
    const none = [makeModel({ id: 'x', isEligible: false })];
    expect(resolveDefaultModel({ models: none })).toBeUndefined();
  });
});

describe('addRecentModel', () => {
  it('prepends most-recent-first and de-duplicates', () => {
    expect(addRecentModel('b', ['a', 'b', 'c'])).toEqual(['b', 'a', 'c']);
  });

  it('caps the list at the limit', () => {
    const long = Array.from({ length: RECENT_MODELS_LIMIT }, (_, i) => `m${i}`);
    const result = addRecentModel('new', long);
    expect(result).toHaveLength(RECENT_MODELS_LIMIT);
    expect(result[0]).toBe('new');
    expect(result).not.toContain(`m${RECENT_MODELS_LIMIT - 1}`);
  });
});

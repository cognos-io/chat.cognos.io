import { describe, expect, it } from 'vitest';

import { Model } from '@app/interfaces/model';

import {
  EMPTY_MODEL_CAPABILITY_METADATA,
  ModelCapabilityMetadata,
} from './model-capability-metadata';
import {
  CAPABILITY_CONTEXT_TEXT,
  LONG_CONTEXT_THRESHOLD,
  RECENT_MODELS_LIMIT,
  addRecentModel,
  buildSearchSynonyms,
  capabilityContextKey,
  formatContextWindow,
  isLongContextModel,
  isLowCostModel,
  isReasoningModel,
  isWebSearchModel,
  matchesQuickFilter,
  modelMatchesSearch,
  modelReleasedTime,
  modelStrengthPills,
  modelSupportsCapability,
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
    displayName: 'Model A',
    slug: 'model-a',
    providerId: 'requesty',
    providerName: 'Requesty',
    description: 'A general purpose model.',
    privacyTier: 'eu',
    tags: [],
    contentTypes: ['text'],
    inputContextLength: 8_192,
    pricing: { inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 1 },
    supportsTextCompletion: true,
    supportsImageGeneration: false,
    supportsVision: false,
    supportsFileInput: false,
    supportsToolCalling: false,
    supportsWebSearch: false,
    supportsComputerUse: false,
    eligibleForCompaction: false,
    supportsStructuredOutput: false,
    supportsCacheHints: false,
    approxCharsPerToken: 0,
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

  it('matches pinned models from the caller-provided pinned ids', () => {
    expect(
      matchesQuickFilter(makeModel({ id: 'pinned-1' }), 'pinned', meta, 'eu', [
        'pinned-1',
      ]),
    ).toBe(true);
    expect(
      matchesQuickFilter(makeModel({ id: 'other' }), 'pinned', meta, 'eu', [
        'pinned-1',
      ]),
    ).toBe(false);
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
      matchesQuickFilter(makeModel({ supportsWebSearch: true }), 'web_search', meta),
    ).toBe(true);
    expect(
      matchesQuickFilter(makeModel({ supportsVision: true }), 'vision', meta),
    ).toBe(true);
    expect(
      matchesQuickFilter(
        makeModel({ inputContextLength: 300_000 }),
        'long_context',
        meta,
      ),
    ).toBe(true);
  });

  it('limits recommended matches to the current data-processing tier when set', () => {
    const tieredMeta = metaFor({
      swiss: { recommended: true, recommendedForPrivacyTiers: ['ch_only'] },
      europe: { recommended: true, recommendedForPrivacyTiers: ['eu', 'global'] },
    });

    expect(
      matchesQuickFilter(
        makeModel({ id: 'swiss' }),
        'recommended',
        tieredMeta,
        'ch_only',
      ),
    ).toBe(true);
    expect(
      matchesQuickFilter(makeModel({ id: 'swiss' }), 'recommended', tieredMeta, 'eu'),
    ).toBe(false);
    expect(
      matchesQuickFilter(makeModel({ id: 'europe' }), 'recommended', tieredMeta, 'eu'),
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
    expect(modelMatchesSearch(image, 'image')).toBe(true);
    const vision = makeModel({ supportsVision: true });
    expect(modelMatchesSearch(vision, 'vision')).toBe(true);
    const web = makeModel({ supportsWebSearch: true });
    expect(modelMatchesSearch(web, 'web search')).toBe(true);
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
      webSearch: 'web suchen',
      private: 'privat schweiz',
      unknownIntent: 'ignored',
    });
    expect(synonyms['gunstig']).toEqual(['low cost']);
    expect(synonyms['web']).toEqual(['web search']);
    expect(synonyms['suchen']).toEqual(['web search']);
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

  const ids = (result: ReturnType<typeof orderModels>) => result.map((m) => m.id);

  it('returns one flat list with recommended models first by default', () => {
    const result = orderModels({
      models,
      pinnedIds: ['b'],
      recentIds: ['d', 'b'],
      hiddenIds: [],
      meta,
    });
    // No grouping/hoisting: recommended (c) leads, the rest keep catalogue order.
    expect(ids(result)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('removes hidden models unless showHidden is set', () => {
    const hidden = orderModels({
      models,
      pinnedIds: [],
      recentIds: [],
      hiddenIds: ['a'],
      meta,
    });
    expect(ids(hidden)).not.toContain('a');

    const shown = orderModels({
      models,
      pinnedIds: [],
      recentIds: [],
      hiddenIds: ['a'],
      showHidden: true,
      meta,
    });
    expect(ids(shown)).toContain('a');
  });

  it('applies the required capability filter', () => {
    const withImage = [
      ...models,
      makeModel({ id: 'img', supportsImageGeneration: true }),
    ];
    const result = orderModels({
      models: withImage,
      pinnedIds: [],
      recentIds: [],
      hiddenIds: [],
      requiredCapability: 'image_generation',
      meta,
    });
    expect(ids(result)).toEqual(['img']);
  });

  it('applies quick filter and search together', () => {
    const result = orderModels({
      models,
      pinnedIds: [],
      recentIds: [],
      hiddenIds: [],
      quickFilter: 'recommended',
      query: 'charlie',
      meta,
    });
    expect(ids(result)).toEqual(['c']);
  });

  it('applies the pinned quick filter to pinned models only', () => {
    const result = orderModels({
      models,
      pinnedIds: ['b', 'd'],
      recentIds: ['c'],
      hiddenIds: [],
      quickFilter: 'pinned',
      meta,
    });
    expect(ids(result)).toEqual(['b', 'd']);
  });

  it('keeps ineligible models in the list (shown disabled by the UI)', () => {
    const withIneligible = [...models, makeModel({ id: 'locked', isEligible: false })];
    const result = orderModels({
      models: withIneligible,
      pinnedIds: [],
      recentIds: [],
      hiddenIds: [],
      meta,
    });
    expect(ids(result)).toContain('locked');
  });

  it('uses tier-aware recommendations for the default ordering', () => {
    const tiered = [
      makeModel({ id: 'swiss' }),
      makeModel({ id: 'europe' }),
      makeModel({ id: 'other' }),
    ];
    const tieredMeta = metaFor({
      swiss: { recommended: true, recommendedForPrivacyTiers: ['ch_only'] },
      europe: { recommended: true, recommendedForPrivacyTiers: ['eu'] },
    });

    const result = orderModels({
      models: tiered,
      pinnedIds: [],
      recentIds: [],
      hiddenIds: [],
      privacyTier: 'eu',
      meta: tieredMeta,
    });

    // Only the eu-recommended model leads; swiss is not recommended for eu.
    expect(ids(result)).toEqual(['europe', 'swiss', 'other']);
  });

  it('does not mutate the caller-provided models array', () => {
    const input = [
      makeModel({ id: 'x', releasedAt: '2023-01-01T00:00:00Z' }),
      makeModel({ id: 'y', releasedAt: '2025-01-01T00:00:00Z' }),
    ];
    const before = input.map((m) => m.id);
    orderModels({
      models: input,
      pinnedIds: [],
      recentIds: [],
      hiddenIds: [],
      sort: 'newest',
    });
    expect(input.map((m) => m.id)).toEqual(before);
  });
});

describe('modelReleasedTime', () => {
  it('parses an ISO date to epoch millis', () => {
    expect(modelReleasedTime(makeModel({ releasedAt: '2024-01-01T00:00:00Z' }))).toBe(
      Date.parse('2024-01-01T00:00:00Z'),
    );
  });

  it('returns -Infinity for missing or unparseable dates so they sort last', () => {
    expect(modelReleasedTime(makeModel({ releasedAt: undefined }))).toBe(-Infinity);
    expect(modelReleasedTime(makeModel({ releasedAt: '' }))).toBe(-Infinity);
    expect(modelReleasedTime(makeModel({ releasedAt: 'not-a-date' }))).toBe(-Infinity);
  });
});

describe('orderModels sort modes', () => {
  const ids = (result: ReturnType<typeof orderModels>) => result.map((m) => m.id);

  const dated = [
    makeModel({ id: 'old', releasedAt: '2023-01-01T00:00:00Z' }),
    makeModel({ id: 'new', releasedAt: '2025-01-01T00:00:00Z' }),
    makeModel({ id: 'mid', releasedAt: '2024-01-01T00:00:00Z' }),
    makeModel({ id: 'undated' }),
  ];

  it("'newest' sorts most-recent-first with undated last", () => {
    const result = orderModels({
      models: dated,
      pinnedIds: [],
      recentIds: [],
      hiddenIds: [],
      sort: 'newest',
    });
    expect(ids(result)).toEqual(['new', 'mid', 'old', 'undated']);
  });

  it("'recent' sorts most-recently-used first, unused last in catalogue order", () => {
    const result = orderModels({
      models: dated,
      pinnedIds: [],
      // Most-recent-first: mid used most recently, then old.
      recentIds: ['mid', 'old'],
      hiddenIds: [],
      sort: 'recent',
    });
    // mid, old lead by recency; new + undated keep their catalogue order after.
    expect(ids(result)).toEqual(['mid', 'old', 'new', 'undated']);
  });

  it("'cost_asc' and 'cost_desc' order by blended price", () => {
    const priced = [
      makeModel({
        id: 'cheap',
        pricing: { inputUsdPerMillionTokens: 0.5, outputUsdPerMillionTokens: 0.5 },
      }),
      makeModel({
        id: 'pricey',
        pricing: { inputUsdPerMillionTokens: 30, outputUsdPerMillionTokens: 60 },
      }),
      makeModel({
        id: 'mid',
        pricing: { inputUsdPerMillionTokens: 3, outputUsdPerMillionTokens: 6 },
      }),
    ];
    const asc = orderModels({
      models: priced,
      pinnedIds: [],
      recentIds: [],
      hiddenIds: [],
      sort: 'cost_asc',
    });
    expect(ids(asc)).toEqual(['cheap', 'mid', 'pricey']);

    const desc = orderModels({
      models: priced,
      pinnedIds: [],
      recentIds: [],
      hiddenIds: [],
      sort: 'cost_desc',
    });
    expect(ids(desc)).toEqual(['pricey', 'mid', 'cheap']);
  });
});

describe('modelSupportsCapability', () => {
  it('gates text completion on supportsTextCompletion', () => {
    expect(
      modelSupportsCapability(
        makeModel({ supportsTextCompletion: true }),
        'text_completion',
      ),
    ).toBe(true);
    expect(
      modelSupportsCapability(
        makeModel({ supportsTextCompletion: false }),
        'text_completion',
      ),
    ).toBe(false);
  });

  it('gates image generation on supportsImageGeneration', () => {
    expect(
      modelSupportsCapability(
        makeModel({ supportsImageGeneration: true }),
        'image_generation',
      ),
    ).toBe(true);
    expect(
      modelSupportsCapability(
        makeModel({ supportsImageGeneration: false }),
        'image_generation',
      ),
    ).toBe(false);
  });

  it('matches every model when the capability is null', () => {
    expect(
      modelSupportsCapability(
        makeModel({ supportsTextCompletion: false, supportsImageGeneration: false }),
        null,
      ),
    ).toBe(true);
  });
});

describe('capabilityContextKey', () => {
  it('maps image generation to its own context key', () => {
    expect(capabilityContextKey('image_generation')).toBe('image_generation');
  });

  it('maps text completion and null to the text context', () => {
    expect(capabilityContextKey('text_completion')).toBe(CAPABILITY_CONTEXT_TEXT);
    expect(capabilityContextKey(null)).toBe(CAPABILITY_CONTEXT_TEXT);
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

  it('is tier-aware when picking a recommended default', () => {
    const tiered = [
      makeModel({ id: 'swiss' }),
      makeModel({ id: 'europe' }),
      makeModel({ id: 'plain' }),
    ];
    const tieredMeta = metaFor({
      swiss: {
        recommended: true,
        recommendedDefaultFor: ['chat'],
        recommendedForPrivacyTiers: ['ch_only'],
      },
      europe: {
        recommended: true,
        recommendedDefaultFor: ['chat'],
        recommendedForPrivacyTiers: ['eu', 'global'],
      },
    });

    expect(
      resolveDefaultModel({
        models: tiered,
        privacyTier: 'ch_only',
        meta: tieredMeta,
      })?.id,
    ).toBe('swiss');
    expect(
      resolveDefaultModel({
        models: tiered,
        privacyTier: 'eu',
        meta: tieredMeta,
      })?.id,
    ).toBe('europe');
  });

  it('uses the curated EU and Swiss catalogue defaults', () => {
    const defaults = [
      makeModel({ id: 'gemini-3-5-flash', privacyTier: 'eu' }),
      makeModel({
        id: 'qwen-qwen3-5-122b-a10b-fp8-infomaniak',
        privacyTier: 'ch_only',
      }),
      makeModel({ id: 'plain' }),
    ];

    expect(resolveDefaultModel({ models: defaults, privacyTier: 'eu' })?.id).toBe(
      'gemini-3-5-flash',
    );
    expect(resolveDefaultModel({ models: defaults, privacyTier: 'ch_only' })?.id).toBe(
      'qwen-qwen3-5-122b-a10b-fp8-infomaniak',
    );
  });

  it('falls back to the first eligible visible model when nothing is recommended', () => {
    const plain = [
      makeModel({ id: 'x', isEligible: false }),
      makeModel({ id: 'y' }),
      makeModel({ id: 'z' }),
    ];
    expect(resolveDefaultModel({ models: plain })?.id).toBe('y');
  });

  it('falls back to an eligible model when every eligible model is hidden', () => {
    // Hiding all usable models must not leave chat stuck on an ineligible one.
    const all = [makeModel({ id: 'a' }), makeModel({ id: 'b' })];
    expect(resolveDefaultModel({ models: all, hiddenIds: ['a', 'b'] })?.id).toBe('a');
  });

  it('returns undefined when no eligible model exists', () => {
    const none = [makeModel({ id: 'x', isEligible: false })];
    expect(resolveDefaultModel({ models: none })).toBeUndefined();
  });

  it('skips an image-only session pick under the text-completion capability', () => {
    // The session pick is an image-only model, but text completion is required,
    // so resolution falls through to the eligible text model (spec §6).
    const mixed = [
      makeModel({
        id: 'image-only',
        supportsTextCompletion: false,
        supportsImageGeneration: true,
      }),
      makeModel({ id: 'text' }),
    ];
    expect(
      resolveDefaultModel({
        models: mixed,
        sessionSelectedId: 'image-only',
        requiredCapability: 'text_completion',
      })?.id,
    ).toBe('text');
  });
});

describe('formatContextWindow', () => {
  it('formats thousands and millions', () => {
    expect(formatContextWindow(128_000)).toBe('128K');
    expect(formatContextWindow(1_000_000)).toBe('1M');
    // Non-integer millions keep one decimal (matches the settings formatter).
    expect(formatContextWindow(1_048_576)).toBe('1.0M');
    expect(formatContextWindow(1_500_000)).toBe('1.5M');
    expect(formatContextWindow(512)).toBe('512');
  });
});

describe('modelStrengthPills', () => {
  it('combines curated flags with derived capability pills in order', () => {
    const meta = metaFor({
      m: { recommendedDefaultFor: ['chat'], fast: true },
    });
    const model = makeModel({
      id: 'm',
      reasoningEfforts: ['high'],
      inputContextLength: 300_000,
      pricing: { inputUsdPerMillionTokens: 0.1, outputUsdPerMillionTokens: 0.1 },
    });
    expect(modelStrengthPills(model, meta)).toEqual([
      'everyday',
      'fast',
      'reasoning',
      'longContext',
    ]);
  });

  it('omits cost and privacy pills (shown by the lozenge / always private)', () => {
    const lowCostSwiss = makeModel({
      privacyTier: 'ch_only',
      pricing: { inputUsdPerMillionTokens: 0.1, outputUsdPerMillionTokens: 0.1 },
    });
    expect(modelStrengthPills(lowCostSwiss)).not.toContain('lowCost');
    expect(modelStrengthPills(lowCostSwiss)).not.toContain('private');
  });

  it.each([
    [true, true],
    [false, false],
  ])(
    'includes the webSearch pill iff supportsWebSearch is %s',
    (supportsWebSearch, expected) => {
      const model = makeModel({ supportsWebSearch });
      expect(isWebSearchModel(model)).toBe(expected);
      expect(modelStrengthPills(model).includes('webSearch')).toBe(expected);
    },
  );
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

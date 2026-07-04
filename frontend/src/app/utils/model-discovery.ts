import { Model } from '@app/interfaces/model';

import {
  ModelCapabilityMetadata,
  ModelPurpose,
  modelCapabilityMetadata as defaultMetadata,
} from './model-capability-metadata';
import { deriveModelCostTier } from './model-cost-tier';

// Pure, browser-only model discovery helpers: normalisation, search matching,
// capability-filter predicates, the ordering pipeline, and contextual default
// resolution. No service or DOM dependencies so they stay fast and testable
// (see docs/specs/composer-model-discovery.md §7). Nothing here calls an API or
// reads prompt text — search runs entirely client-side.

// The capability the current composer state requires of the model. The composer
// is never in a "no constraint" state: plain chat requires `text_completion`,
// the image tool requires `image_generation` (spec
// docs/specs/tool-aware-model-selection.md §2). `null` remains a valid input —
// the account-settings model list passes it to show every model unfiltered.
export type RequiredCapability = 'text_completion' | 'image_generation' | null;

// CAPABILITY_CONTEXT_TEXT is the context key for plain text completion. Its
// remembered default lives in `defaultModelId` (not `toolModelDefaults`), so the
// chat default is byte-for-byte backward compatible (spec §5).
export const CAPABILITY_CONTEXT_TEXT = 'text';

// capabilityContextKey maps a required capability to the stable key used to
// store the user's per-context default model (spec §2/§5). Text completion (and
// the unconstrained `null`) map to the `"text"` context.
export function capabilityContextKey(capability: RequiredCapability): string {
  return capability === 'image_generation'
    ? 'image_generation'
    : CAPABILITY_CONTEXT_TEXT;
}

// Quick capability filters surfaced as chips. 'recommended' is the default chip.
export type QuickFilter =
  | 'recommended'
  | 'fast'
  | 'powerful'
  | 'low_cost'
  | 'reasoning'
  | 'image'
  | 'vision'
  | 'long_context';

// A quick-filter chip: a filter key and its i18n label key. Shared by the
// composer selector and account settings so the two surfaces never drift.
export interface ModelFilterChip {
  key: QuickFilter;
  labelKey: string;
}

export const MODEL_FILTER_CHIPS: readonly ModelFilterChip[] = [
  { key: 'recommended', labelKey: 'chat.models.filters.recommended' },
  { key: 'fast', labelKey: 'chat.models.filters.fast' },
  { key: 'powerful', labelKey: 'chat.models.filters.powerful' },
  { key: 'low_cost', labelKey: 'chat.models.filters.lowCost' },
  { key: 'reasoning', labelKey: 'chat.models.filters.reasoning' },
  { key: 'image', labelKey: 'chat.models.filters.image' },
  { key: 'vision', labelKey: 'chat.models.filters.vision' },
  { key: 'long_context', labelKey: 'chat.models.filters.longContext' },
];

// Documented "long context" threshold (§5.3). Set at 300k so the label marks
// genuinely large windows (the 1M-token frontier models and 300k+ models),
// not the now-common 128k baseline. Change here to retune it everywhere.
export const LONG_CONTEXT_THRESHOLD = 300_000;

// Most-recent-first recent-model list cap (§5.4).
export const RECENT_MODELS_LIMIT = 8;

// A metadata lookup, injectable so tests and curated data can vary it.
export type MetadataLookup = (modelId: string) => ModelCapabilityMetadata;

// normalizeSearchText folds a string to a diacritic- and case-insensitive form
// so a French/Portuguese/German query (e.g. "günstig", "rápido") matches the
// indexed text (§4.2). NFD splits accented letters into base + combining mark,
// then the marks are stripped. Whitespace is collapsed and trimmed.
export function normalizeSearchText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// ---- capability predicates -------------------------------------------------

export function isImageModel(model: Model): boolean {
  return model.supportsImageGeneration;
}

// Vision = the model can read images as input. Distinct from image generation.
export function isVisionModel(model: Model): boolean {
  return model.supportsVision;
}

// Web search = the model can search the public web and cite live sources
// (spec docs/specs/web-search.md §4.3). EU-only enforcement lives server-side;
// the flag as delivered already reflects it.
export function isWebSearchModel(model: Model): boolean {
  return model.supportsWebSearch;
}

// Reasoning is declared by the model offering reasoning-effort tiers (§5.3).
export function isReasoningModel(model: Model): boolean {
  return (model.reasoningEfforts ?? []).length > 0;
}

export function isLowCostModel(model: Model): boolean {
  return deriveModelCostTier(model.pricing) === 'low';
}

export function isLongContextModel(model: Model): boolean {
  return model.inputContextLength >= LONG_CONTEXT_THRESHOLD;
}

export function isRecommendedModel(model: Model, meta: MetadataLookup): boolean {
  return meta(model.id).recommended;
}

export function isFastModel(model: Model, meta: MetadataLookup): boolean {
  return meta(model.id).fast;
}

export function isPowerfulModel(model: Model, meta: MetadataLookup): boolean {
  return meta(model.id).powerful;
}

// matchesQuickFilter applies a single quick-filter chip. A null filter matches
// every model (no chip active beyond the implicit list).
export function matchesQuickFilter(
  model: Model,
  filter: QuickFilter | null,
  meta: MetadataLookup = defaultMetadata,
): boolean {
  switch (filter) {
    case null:
      return true;
    case 'recommended':
      return isRecommendedModel(model, meta);
    case 'fast':
      return isFastModel(model, meta);
    case 'powerful':
      return isPowerfulModel(model, meta);
    case 'low_cost':
      return isLowCostModel(model);
    case 'reasoning':
      return isReasoningModel(model);
    case 'image':
      return isImageModel(model);
    case 'vision':
      return isVisionModel(model);
    case 'long_context':
      return isLongContextModel(model);
  }
}

// modelSupportsCapability gates a model against the active capability context.
// `null` (no constraint) matches every model.
export function modelSupportsCapability(
  model: Model,
  capability: RequiredCapability,
): boolean {
  switch (capability) {
    case 'image_generation':
      return model.supportsImageGeneration;
    case 'text_completion':
      return model.supportsTextCompletion;
    case null:
      return true;
  }
}

// ---- search ----------------------------------------------------------------

export interface SearchContext {
  meta?: MetadataLookup;
  // Localised cost-tier word (e.g. "Low cost") so a cost search matches.
  costTierLabel?: (model: Model) => string;
  // Normalised synonym map: a query term maps to extra normalised terms that
  // should also satisfy it (e.g. "cheap" -> ["low cost"]). Provided by the
  // i18n synonym layer; pure here so it can be tested with a fixture map.
  synonyms?: Record<string, string[]>;
  // Extra localised terms to index per model (strength labels, aliases).
  extraTerms?: (model: Model) => string[];
}

// modelSearchHaystack builds the normalised text a query is matched against:
// catalogue fields, hosting, tags, derived capability words, the cost tier, and
// any caller-supplied localised terms. Capability words are included in English
// as stable anchors; localised equivalents arrive via extraTerms/synonyms.
export function modelSearchHaystack(model: Model, ctx: SearchContext = {}): string {
  const meta = (ctx.meta ?? defaultMetadata)(model.id);
  const parts: string[] = [
    model.name,
    model.providerName ?? '',
    model.providerId,
    model.description,
    model.hostingCountry ?? '',
    model.hostingRegion ?? '',
    ...(model.tags ?? []).map((tag) => tag.title),
    ctx.costTierLabel?.(model) ?? '',
    ...(ctx.extraTerms?.(model) ?? []),
    ...meta.aliases,
  ];

  if (isImageModel(model)) parts.push('image generation');
  if (isVisionModel(model)) parts.push('vision');
  if (isReasoningModel(model)) parts.push('reasoning');
  if (isLowCostModel(model)) parts.push('low cost cheap');
  if (isLongContextModel(model)) parts.push('long context');
  if (meta.recommended) parts.push('recommended');
  if (meta.fast) parts.push('fast');
  if (meta.powerful) parts.push('powerful');
  // Privacy anchors so a "private"/"swiss" search reaches the right models.
  if (model.noRetention || model.privacyTier === 'ch_only') parts.push('private');
  if (
    (model.hostingRegion ?? '').toLowerCase() === 'ch' ||
    (model.hostingCountry ?? '').toLowerCase() === 'ch' ||
    model.privacyTier === 'ch_only'
  ) {
    parts.push('swiss switzerland');
  }

  return normalizeSearchText(parts.join(' '));
}

// Maps a search intent (quick-filter / strength) to the stable English anchor
// word(s) indexed in the haystack. Localised trigger words resolve to these, so
// a German "günstig" search finds the model whose haystack contains "low cost".
export const SEARCH_INTENT_ANCHORS: Readonly<Record<string, string>> = {
  lowCost: 'low cost',
  fast: 'fast',
  powerful: 'powerful',
  reasoning: 'reasoning',
  image: 'image',
  longContext: 'long context',
  private: 'private',
};

// buildSearchSynonyms turns the localised i18n synonym map ({intent: "term term"})
// into the {token: anchors[]} form modelMatchesSearch expects. Trigger terms are
// NFD-folded to match the folded query; unknown intents are ignored.
export function buildSearchSynonyms(
  localized: Record<string, string>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [intent, terms] of Object.entries(localized)) {
    const anchor = SEARCH_INTENT_ANCHORS[intent];
    if (!anchor || typeof terms !== 'string') {
      continue;
    }
    for (const token of normalizeSearchText(terms).split(' ')) {
      if (!token) continue;
      (out[token] ??= []).push(anchor);
    }
  }
  return out;
}

// modelMatchesSearch returns true when every token in the query is satisfied by
// the model's haystack — directly or via a synonym expansion. AND semantics
// across tokens narrows results as the user types. An empty query matches all.
export function modelMatchesSearch(
  model: Model,
  query: string,
  ctx: SearchContext = {},
): boolean {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return true;
  }
  const haystack = modelSearchHaystack(model, ctx);
  const synonyms = ctx.synonyms ?? {};
  const tokens = normalizedQuery.split(' ');

  return tokens.every((token) => {
    if (haystack.includes(token)) {
      return true;
    }
    const expansions = synonyms[token] ?? [];
    return expansions.some((expansion) => haystack.includes(expansion));
  });
}

// formatContextWindow renders a token count as a short human label
// (128000 -> "128K", 1_000_000 -> "1M"). Pure, shared by the composer selector
// and account settings so both stay consistent.
export function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000;
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`;
  }
  if (tokens >= 1000) {
    return `${Math.round(tokens / 1000)}K`;
  }
  return `${tokens}`;
}

// ---- strength pills --------------------------------------------------------

// modelStrengthPills returns the ordered i18n strength keys for a row, combining
// curated flags (everyday/fast/powerful) with predicates derived from public
// metadata (reasoning/image/long context). Keys map to chat.models.strengths.*;
// the caller localises and may cap the count.
//
// Cost is intentionally NOT a pill — it is shown by the cost lozenge. Privacy is
// not a pill either: every Cognos model is private, so the label adds no signal.
export function modelStrengthPills(
  model: Model,
  meta: MetadataLookup = defaultMetadata,
): string[] {
  const m = meta(model.id);
  const keys: string[] = [];
  if (m.recommendedDefaultFor.includes('chat')) keys.push('everyday');
  if (m.fast) keys.push('fast');
  if (m.powerful) keys.push('powerful');
  if (isReasoningModel(model)) keys.push('reasoning');
  if (isImageModel(model)) keys.push('image');
  if (isVisionModel(model)) keys.push('vision');
  if (isWebSearchModel(model)) keys.push('webSearch');
  if (isLongContextModel(model)) keys.push('longContext');
  return keys;
}

// ---- ordering pipeline -----------------------------------------------------

export type ModelGroupKey = 'pinned' | 'recent' | 'recommended' | 'other';

export interface ModelGroup {
  key: ModelGroupKey;
  models: Model[];
}

export interface OrderModelsInput {
  models: Model[];
  // Frozen pin order captured when the dropdown opens, so rows don't jump.
  pinnedIds: readonly string[];
  // Most-recent-first.
  recentIds: readonly string[];
  hiddenIds: readonly string[];
  requiredCapability?: RequiredCapability;
  quickFilter?: QuickFilter | null;
  query?: string;
  // When true, hidden models are kept (e.g. "show hidden matches").
  showHidden?: boolean;
  meta?: MetadataLookup;
  searchContext?: SearchContext;
}

// orderModels implements the §7 pipeline and returns grouped rows. The selected
// model is NOT hoisted; it stays in its natural group (the UI marks it). Groups
// are de-duplicated in order: pinned → recent → recommended → other.
export function orderModels(input: OrderModelsInput): ModelGroup[] {
  const meta = input.meta ?? defaultMetadata;
  const hidden = new Set(input.hiddenIds);
  const capability = input.requiredCapability ?? null;
  const quickFilter = input.quickFilter ?? null;
  const searchContext: SearchContext = { meta, ...input.searchContext };

  const visible = input.models.filter((model) => {
    if (!modelSupportsCapability(model, capability)) return false;
    if (!input.showHidden && hidden.has(model.id)) return false;
    if (!matchesQuickFilter(model, quickFilter, meta)) return false;
    if (!modelMatchesSearch(model, input.query ?? '', searchContext)) return false;
    return true;
  });

  const byId = new Map(visible.map((model) => [model.id, model]));
  const used = new Set<string>();

  const take = (ids: readonly string[]): Model[] => {
    const picked: Model[] = [];
    for (const id of ids) {
      if (used.has(id)) continue;
      const model = byId.get(id);
      if (model) {
        picked.push(model);
        used.add(id);
      }
    }
    return picked;
  };

  const pinned = take(input.pinnedIds);
  const recent = take(input.recentIds);
  const recommended = take(
    visible.filter((model) => meta(model.id).recommended).map((model) => model.id),
  );
  const other = visible.filter((model) => !used.has(model.id));

  return [
    { key: 'pinned', models: pinned },
    { key: 'recent', models: recent },
    { key: 'recommended', models: recommended },
    { key: 'other', models: other },
  ];
}

// flattenGroups collapses groups into a single ordered list (e.g. for keyboard
// navigation or when section headers aren't rendered).
export function flattenGroups(groups: ModelGroup[]): Model[] {
  return groups.flatMap((group) => group.models);
}

// ---- contextual default resolution -----------------------------------------

export interface ResolveDefaultInput {
  models: Model[];
  // Explicit pick for this chat/session (highest priority).
  sessionSelectedId?: string;
  // Encrypted project default, when in a project.
  projectDefaultId?: string;
  // Encrypted user default.
  userDefaultId?: string;
  hiddenIds?: readonly string[];
  requiredCapability?: RequiredCapability;
  meta?: MetadataLookup;
}

// A model is usable as a default when it exists, is eligible, supports the
// active capability, and is not hidden (a hidden default falls through, §5.5).
function isUsableDefault(
  model: Model | undefined,
  hidden: Set<string>,
  capability: RequiredCapability,
): model is Model {
  return (
    !!model &&
    model.isEligible &&
    !hidden.has(model.id) &&
    modelSupportsCapability(model, capability)
  );
}

// resolveDefaultModel implements the §5.6/§5.7 resolution order:
// session pick → project default → user default → recommended eligible
// (purpose-aware) → first eligible visible → first eligible (even if hidden).
// The last step keeps chat usable when the user has hidden every model they can
// use: an eligible-but-hidden model still works, and beats an ineligible one.
// Returns undefined only when no eligible model exists at all.
export function resolveDefaultModel(input: ResolveDefaultInput): Model | undefined {
  const meta = input.meta ?? defaultMetadata;
  const hidden = new Set(input.hiddenIds ?? []);
  const capability = input.requiredCapability ?? null;
  const byId = new Map(input.models.map((model) => [model.id, model]));

  const usable = (id?: string): Model | undefined => {
    if (!id) return undefined;
    const model = byId.get(id);
    return isUsableDefault(model, hidden, capability) ? model : undefined;
  };

  const explicit =
    usable(input.sessionSelectedId) ??
    usable(input.projectDefaultId) ??
    usable(input.userDefaultId);
  if (explicit) {
    return explicit;
  }

  // Purpose-aware recommendation: prefer a model curated for the active purpose.
  const purpose: ModelPurpose = capability === 'image_generation' ? 'image' : 'chat';
  const eligibleVisible = input.models.filter((model) =>
    isUsableDefault(model, hidden, capability),
  );
  const recommendedForPurpose = eligibleVisible.find((model) =>
    meta(model.id).recommendedDefaultFor.includes(purpose),
  );
  if (recommendedForPurpose) {
    return recommendedForPurpose;
  }
  const anyRecommended = eligibleVisible.find((model) => meta(model.id).recommended);
  if (anyRecommended) {
    return anyRecommended;
  }
  if (eligibleVisible[0]) {
    return eligibleVisible[0];
  }

  // Everything eligible is hidden: still pick an eligible model so the composer
  // stays usable (the user can unhide from settings) rather than falling to an
  // ineligible catalogue entry.
  return input.models.find(
    (model) => model.isEligible && modelSupportsCapability(model, capability),
  );
}

// ---- recent models ---------------------------------------------------------

// addRecentModel prepends an id to a most-recent-first list, de-duplicating and
// capping it (§5.4). Pure so the cap/dedup behaviour is unit-tested directly.
export function addRecentModel(
  id: string,
  list: readonly string[],
  cap = RECENT_MODELS_LIMIT,
): string[] {
  return [id, ...list.filter((existing) => existing !== id)].slice(0, cap);
}

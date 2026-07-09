import { resolveOverlaps } from './redaction-engine';
import { RedactionCandidate, RedactionType } from './redaction-types';

type NlpDocument = {
  people(): NlpView;
  organizations(): NlpView;
  places(): NlpView;
};

type NlpView = {
  json(options: { offset: true }): NlpMatch[];
};

type NlpMatch = {
  text?: string;
  normal?: string;
  offset?: {
    start: number;
    length: number;
  };
};

type NlpFactory = (text: string) => NlpDocument;

const ORG_DESIGNATOR_RE =
  /\b(?:ag|gmbh|sa|sarl|ltd|limited|inc|llc|corp|corporation|company|university|school|bank)\b/i;
const LOWERCASE_NAME_PARTICLES = new Set([
  'da',
  'de',
  'del',
  'der',
  'di',
  'du',
  'la',
  'le',
  'van',
  'von',
]);

function trimRange(
  text: string,
  start: number,
  end: number,
): { start: number; end: number } {
  let from = start;
  let to = end;
  while (from < to && /\s/.test(text[from])) from += 1;
  while (to > from && /[\s.,;:!?)]/.test(text[to - 1])) to -= 1;
  while (from < to && /[(]/.test(text[from])) from += 1;
  return { start: from, end: to };
}

function wordTokens(value: string): string[] {
  return value.match(/\p{L}[\p{L}'-]*/gu) ?? [];
}

function isAcronym(token: string): boolean {
  return token.length >= 2 && /^[A-Z0-9&]+$/.test(token);
}

function isTitleToken(token: string): boolean {
  return token
    .split(/[-']/)
    .filter(Boolean)
    .every((part) => /^\p{Lu}/u.test(part));
}

function hasUppercaseSignal(value: string): boolean {
  return wordTokens(value).some((token) => isTitleToken(token) || isAcronym(token));
}

function isSensitiveSurface(type: RedactionType, value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 4 || /[-']$/.test(trimmed)) {
    return false;
  }
  const tokens = wordTokens(trimmed);
  if (tokens.length === 0 || !hasUppercaseSignal(trimmed)) {
    return false;
  }
  if (type === 'person') {
    let titleTokens = 0;
    for (const token of tokens) {
      const lower = token.toLocaleLowerCase();
      if (LOWERCASE_NAME_PARTICLES.has(lower)) {
        continue;
      }
      if (!isTitleToken(token)) {
        return false;
      }
      titleTokens += 1;
    }
    return titleTokens > 0;
  }
  if (type === 'org') {
    return (
      ORG_DESIGNATOR_RE.test(trimmed) || tokens.length > 1 || tokens.some(isAcronym)
    );
  }
  if (type === 'place') {
    return tokens.every((token) => isTitleToken(token) || isAcronym(token));
  }
  return true;
}

function candidatesFromMatches(
  text: string,
  type: RedactionType,
  detector: string,
  matches: readonly NlpMatch[],
): RedactionCandidate[] {
  const out: RedactionCandidate[] = [];
  for (const match of matches) {
    if (!match.offset || match.offset.length <= 0) continue;
    const rawStart = match.offset.start;
    const rawEnd = rawStart + match.offset.length;
    const { start, end } = trimRange(text, rawStart, rawEnd);
    if (end <= start) continue;
    const value = text.slice(start, end);
    if (!isSensitiveSurface(type, value)) continue;
    out.push({
      type,
      detector,
      start,
      end,
      value,
      normalized: (match.normal ?? value).toLocaleLowerCase(),
      confidence: type === 'person' ? 'medium' : 'low',
    });
  }
  return out;
}

export async function detectNlpEntities(text: string): Promise<RedactionCandidate[]> {
  if (!text.trim()) {
    return [];
  }
  const { default: nlp } = (await import('compromise')) as { default: NlpFactory };
  const doc = nlp(text);
  return resolveOverlaps([
    ...candidatesFromMatches(
      text,
      'person',
      'nlp-person:compromise:v1',
      doc.people().json({ offset: true }),
    ),
    ...candidatesFromMatches(
      text,
      'org',
      'nlp-org:compromise:v1',
      doc.organizations().json({ offset: true }),
    ),
    ...candidatesFromMatches(
      text,
      'place',
      'nlp-place:compromise:v1',
      doc.places().json({ offset: true }),
    ),
  ]);
}

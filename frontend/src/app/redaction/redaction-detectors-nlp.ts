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
    if (value.length < 2) continue;
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

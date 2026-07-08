import { Detector, RedactionCandidate } from './redaction-types';

const WINDOW = 24;

const PHONE_KEYWORDS: Record<string, readonly string[]> = {
  en: ['call', 'phone', 'tel', 'mobile', 'fax'],
  de: ['telefon', 'tel', 'handy', 'mobil', 'anrufen'],
  fr: ['telephone', 'téléphone', 'tel', 'mobile', 'appeler'],
  es: ['telefono', 'teléfono', 'movil', 'móvil', 'llamar'],
  pt: ['telefone', 'telemovel', 'telemóvel', 'ligar'],
  it: ['telefono', 'cellulare', 'chiamare'],
};

const DOB_KEYWORDS: Record<string, readonly string[]> = {
  en: ['dob', 'born', 'birth', 'date of birth'],
  de: ['geboren', 'geburtsdatum', 'geburts'],
  fr: ['né le', 'née le', 'naissance'],
  es: ['nacido', 'nacida', 'nacimiento'],
  pt: ['nascido', 'nascida', 'nascimento'],
  it: ['nato', 'nata', 'nascita'],
};

function keywordsFor(
  keywords: Record<string, readonly string[]>,
  locale: string,
): readonly string[] {
  return keywords[locale.slice(0, 2)] ?? keywords['en'];
}

function nearbyKeyword(
  text: string,
  start: number,
  end: number,
  keywords: readonly string[],
): boolean {
  const from = Math.max(0, start - WINDOW);
  const to = Math.min(text.length, end + WINDOW);
  const haystack = text.slice(from, to).toLocaleLowerCase();
  return keywords.some((keyword) => haystack.includes(keyword));
}

const PHONE_RE = /\b(?:\d[\s.-]?){7,11}\b/g;
const DOB_RE = /\b(?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}[./-]\d{1,2}[./-]\d{1,2})\b/g;

function contextCandidate(
  type: 'phone' | 'dob',
  detector: string,
  text: string,
  start: number,
  end: number,
): RedactionCandidate {
  const value = text.slice(start, end);
  return {
    type,
    detector,
    start,
    end,
    value,
    normalized: type === 'phone' ? value.replace(/\D/g, '') : value,
    confidence: 'medium',
  };
}

export function contextDetectorsForLocale(locale: string): readonly Detector[] {
  return [
    {
      id: `phone-context:${locale}`,
      type: 'phone',
      detect(text) {
        const keywords = keywordsFor(PHONE_KEYWORDS, locale);
        const out: RedactionCandidate[] = [];
        for (const match of text.matchAll(PHONE_RE)) {
          const start = match.index ?? 0;
          const end = start + match[0].length;
          const digits = match[0].replace(/\D/g, '');
          if (digits.length < 7 || digits.length > 11) continue;
          if (!nearbyKeyword(text, start, end, keywords)) continue;
          out.push(contextCandidate('phone', 'phone-context:v1', text, start, end));
        }
        return out;
      },
    },
    {
      id: `dob-context:${locale}`,
      type: 'dob',
      detect(text) {
        const keywords = keywordsFor(DOB_KEYWORDS, locale);
        const out: RedactionCandidate[] = [];
        for (const match of text.matchAll(DOB_RE)) {
          const start = match.index ?? 0;
          const end = start + match[0].length;
          if (!nearbyKeyword(text, start, end, keywords)) continue;
          out.push(contextCandidate('dob', 'dob-context:v1', text, start, end));
        }
        return out;
      },
    },
  ];
}

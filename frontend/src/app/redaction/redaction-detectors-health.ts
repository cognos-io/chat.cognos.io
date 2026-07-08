import { Detector, RedactionCandidate } from './redaction-types';

const HEALTH_CARD_RE = /\b80756\d{15}\b/g;

export const swissHealthInsuranceDetector: Detector = {
  id: 'ch-health-card:v1',
  type: 'health',
  detect(text) {
    const out: RedactionCandidate[] = [];
    for (const match of text.matchAll(HEALTH_CARD_RE)) {
      const start = match.index ?? 0;
      out.push({
        type: 'health',
        detector: 'ch-health-card:v1',
        start,
        end: start + match[0].length,
        value: match[0],
        normalized: match[0],
        confidence: 'high',
      });
    }
    return out;
  },
};

const HEALTH_KEYWORDS: Record<string, readonly string[]> = {
  en: ['diagnosis', 'asthma', 'diabetes', 'medication', 'prescription'],
  de: ['diagnose', 'asthma', 'diabetes', 'medikament', 'rezept'],
  fr: ['diagnostic', 'asthme', 'diabète', 'medicament', 'médicament'],
  es: ['diagnostico', 'diagnóstico', 'asma', 'diabetes', 'medicamento'],
  pt: ['diagnostico', 'diagnóstico', 'asma', 'diabetes', 'medicamento'],
  it: ['diagnosi', 'asma', 'diabete', 'farmaco', 'medicinale'],
};

function wordsFor(locale: string): readonly string[] {
  return HEALTH_KEYWORDS[locale.slice(0, 2)] ?? HEALTH_KEYWORDS['en'];
}

export function healthDetectorsForLocale(locale: string): readonly Detector[] {
  return [
    swissHealthInsuranceDetector,
    {
      id: `health-keyword:${locale}`,
      type: 'health',
      detect(text) {
        const lower = text.toLocaleLowerCase();
        const out: RedactionCandidate[] = [];
        for (const word of wordsFor(locale)) {
          const index = lower.indexOf(word);
          if (index === -1) continue;
          out.push({
            type: 'health',
            detector: 'health-keyword:v1',
            start: index,
            end: index + word.length,
            value: text.slice(index, index + word.length),
            normalized: word,
            confidence: 'medium',
          });
          break;
        }
        return out;
      },
    },
  ];
}

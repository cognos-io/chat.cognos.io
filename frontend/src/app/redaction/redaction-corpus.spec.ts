import { describe, expect, it } from 'vitest';

import baselineCorpus from './corpus/baseline-v2.json';
import { detectSensitiveText, detectorsForMode } from './redaction-engine';
import { RedactionCorpusCase, scoreRedactionCorpus } from './redaction-score';
import { RedactionType } from './redaction-types';

interface BaselineCorpusCase {
  id: string;
  locale: string;
  text: string;
  expected: { type: RedactionType; value: string }[];
}

function expandExpectedSpans(item: BaselineCorpusCase): RedactionCorpusCase {
  return {
    id: item.id,
    locale: item.locale,
    text: item.text,
    expected: item.expected.map((expected) => {
      const start = item.text.indexOf(expected.value);
      if (start < 0) {
        throw new Error(`${item.id} is missing expected value ${expected.value}`);
      }
      return {
        type: expected.type,
        start,
        end: start + expected.value.length,
      };
    }),
  };
}

describe('redaction baseline corpus', () => {
  it('keeps better-mode precision and recall above the v2 gate', () => {
    const corpus = (baselineCorpus as BaselineCorpusCase[]).map(expandExpectedSpans);
    const report = scoreRedactionCorpus(
      corpus,
      (text, locale) => detectSensitiveText(text, detectorsForMode('better', locale)),
      {
        dob: { precision: 0.9, recall: 0.9 },
        passport: { precision: 0.9, recall: 0.9 },
        ch_driving_licence: { precision: 0.9, recall: 0.9 },
        ch_postfinance: { precision: 0.9, recall: 0.9 },
        health: { precision: 0.9, recall: 0.9 },
      },
    );

    expect(report.thresholdFailures).toEqual([]);
    expect(report.overall.precision).toBeGreaterThanOrEqual(0.9);
    expect(report.overall.recall).toBeGreaterThanOrEqual(0.9);
  });
});

import { RedactionCandidate, RedactionType } from './redaction-types';

export interface RedactionCorpusExpected {
  type: RedactionType;
  start: number;
  end: number;
}

export interface RedactionCorpusCase {
  id: string;
  locale: string;
  text: string;
  expected: RedactionCorpusExpected[];
}

export interface RedactionThreshold {
  precision: number;
  recall: number;
}

export interface RedactionScoreBucket {
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  precision: number;
  recall: number;
}

export interface RedactionScoreReport {
  overall: RedactionScoreBucket;
  byType: Partial<Record<RedactionType, RedactionScoreBucket>>;
  thresholdFailures: string[];
}

function emptyBucket(): RedactionScoreBucket {
  return {
    truePositive: 0,
    falsePositive: 0,
    falseNegative: 0,
    precision: 1,
    recall: 1,
  };
}

function finalise(bucket: RedactionScoreBucket): RedactionScoreBucket {
  const predicted = bucket.truePositive + bucket.falsePositive;
  const expected = bucket.truePositive + bucket.falseNegative;
  return {
    ...bucket,
    precision: predicted === 0 ? 1 : bucket.truePositive / predicted,
    recall: expected === 0 ? 1 : bucket.truePositive / expected,
  };
}

function sameSpan(
  candidate: Pick<RedactionCandidate, 'type' | 'start' | 'end'>,
  expected: RedactionCorpusExpected,
): boolean {
  return (
    candidate.type === expected.type &&
    candidate.start === expected.start &&
    candidate.end === expected.end
  );
}

function bucketFor(
  buckets: Partial<Record<RedactionType, RedactionScoreBucket>>,
  type: RedactionType,
): RedactionScoreBucket {
  buckets[type] ??= emptyBucket();
  return buckets[type]!;
}

export function scoreRedactionCorpus(
  corpus: readonly RedactionCorpusCase[],
  detect: (text: string, locale: string) => readonly RedactionCandidate[],
  thresholds: Partial<Record<RedactionType, RedactionThreshold>> = {},
): RedactionScoreReport {
  const overall = emptyBucket();
  const byType: Partial<Record<RedactionType, RedactionScoreBucket>> = {};

  for (const item of corpus) {
    const expected = [...item.expected];
    const matchedExpected = new Set<number>();
    const candidates = detect(item.text, item.locale);

    for (const candidate of candidates) {
      const matchIndex = expected.findIndex(
        (entry, index) => !matchedExpected.has(index) && sameSpan(candidate, entry),
      );
      const bucket = bucketFor(byType, candidate.type);
      if (matchIndex === -1) {
        bucket.falsePositive += 1;
        overall.falsePositive += 1;
      } else {
        matchedExpected.add(matchIndex);
        bucket.truePositive += 1;
        overall.truePositive += 1;
      }
    }

    expected.forEach((entry, index) => {
      if (!matchedExpected.has(index)) {
        bucketFor(byType, entry.type).falseNegative += 1;
        overall.falseNegative += 1;
      }
    });
  }

  for (const [type, bucket] of Object.entries(byType) as [
    RedactionType,
    RedactionScoreBucket,
  ][]) {
    byType[type] = finalise(bucket);
  }
  const finalOverall = finalise(overall);

  const thresholdFailures: string[] = [];
  for (const [type, threshold] of Object.entries(thresholds) as [
    RedactionType,
    RedactionThreshold,
  ][]) {
    const bucket = byType[type] ?? finalise(emptyBucket());
    if (bucket.precision < threshold.precision) {
      thresholdFailures.push(
        `${type} precision ${bucket.precision.toFixed(3)} below threshold ${threshold.precision.toFixed(3)}`,
      );
    }
    if (bucket.recall < threshold.recall) {
      thresholdFailures.push(
        `${type} recall ${bucket.recall.toFixed(3)} below threshold ${threshold.recall.toFixed(3)}`,
      );
    }
  }

  return { overall: finalOverall, byType, thresholdFailures };
}

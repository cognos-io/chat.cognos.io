import { describe, expect, it } from 'vitest';

import { REDACTION_SEVERITY_ORDER, redactionSeverity } from './redaction-severity';
import { REDACTION_TYPES } from './redaction-types';

describe('redactionSeverity', () => {
  it('classifies every redaction type', () => {
    for (const type of REDACTION_TYPES) {
      expect(redactionSeverity(type), type).toMatch(/^(low|medium|high|critical)$/);
    }
  });

  it('keeps credentials critical and financial/health identifiers high', () => {
    expect(redactionSeverity('secret')).toBe('critical');
    expect(redactionSeverity('credit_card')).toBe('high');
    expect(redactionSeverity('iban')).toBe('high');
    expect(redactionSeverity('health')).toBe('high');
  });

  it('orders severities from most to least risky', () => {
    expect(REDACTION_SEVERITY_ORDER).toEqual(['critical', 'high', 'medium', 'low']);
  });
});

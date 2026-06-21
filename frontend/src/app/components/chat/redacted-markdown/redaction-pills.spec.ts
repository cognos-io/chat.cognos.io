import { describe, expect, it } from 'vitest';

import { injectRedactionPills } from './redaction-pills';

const IBAN_TOKEN = '[[PII_IBAN_Q7K9M2]]';
const EMAIL_TOKEN = '[[PII_EMAIL_A8F2KD]]';

// A pill stand-in so the test asserts placement without the real component.
const makePill = (token: string): Node => {
  const span = document.createElement('span');
  span.setAttribute('data-pill', token);
  span.textContent = 'PILL';
  return span;
};

const has = (...tokens: string[]) => {
  const set = new Set(tokens);
  return (token: string) => set.has(token);
};

describe('injectRedactionPills', () => {
  it('replaces a known token with a pill, preserving surrounding text', () => {
    const root = document.createElement('p');
    root.textContent = `Pay ${IBAN_TOKEN} now`;

    injectRedactionPills(root, has(IBAN_TOKEN), makePill);

    const pill = root.querySelector('[data-pill]');
    expect(pill?.getAttribute('data-pill')).toBe(IBAN_TOKEN);
    expect(root.textContent).toBe('Pay PILL now');
    expect(root.childNodes).toHaveLength(3); // "Pay ", pill, " now"
  });

  it('replaces only tokens that have an entry', () => {
    const root = document.createElement('p');
    root.textContent = `${IBAN_TOKEN} and ${EMAIL_TOKEN}`;

    injectRedactionPills(root, has(IBAN_TOKEN), makePill);

    expect(root.querySelectorAll('[data-pill]')).toHaveLength(1);
    // The unknown token is left untouched.
    expect(root.textContent).toContain(EMAIL_TOKEN);
  });

  it('handles multiple tokens and nested markup', () => {
    const root = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = `case ${IBAN_TOKEN}`;
    root.append(document.createTextNode(`Mail ${EMAIL_TOKEN} re: `), strong);

    injectRedactionPills(root, has(IBAN_TOKEN, EMAIL_TOKEN), makePill);

    expect(root.querySelectorAll('[data-pill]')).toHaveLength(2);
    // The pill inside <strong> stays inside <strong>.
    expect(strong.querySelector('[data-pill]')).not.toBeNull();
    expect(root.textContent).not.toContain('[[PII_');
  });

  it('leaves token-free content unchanged', () => {
    const root = document.createElement('p');
    root.textContent = 'nothing to see here';

    injectRedactionPills(root, has(IBAN_TOKEN), makePill);

    expect(root.querySelector('[data-pill]')).toBeNull();
    expect(root.textContent).toBe('nothing to see here');
  });
});

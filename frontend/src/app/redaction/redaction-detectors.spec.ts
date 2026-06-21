import { describe, expect, it } from 'vitest';

import {
  creditCardDetector,
  emailDetector,
  ibanDetector,
  isValidEan13,
  isValidIbanChecksum,
  isValidLuhn,
  secretDetector,
  swissAhvDetector,
  ukNinoDetector,
} from './redaction-detectors';

describe('checksums', () => {
  it('validates IBAN mod-97', () => {
    expect(isValidIbanChecksum('GB82WEST12345698765432')).toBe(true);
    expect(isValidIbanChecksum('CH9300762011623852957')).toBe(true);
    expect(isValidIbanChecksum('GB00WEST12345698765432')).toBe(false);
  });

  it('validates Luhn', () => {
    expect(isValidLuhn('4111111111111111')).toBe(true);
    expect(isValidLuhn('4242424242424242')).toBe(true);
    expect(isValidLuhn('4111111111111112')).toBe(false);
  });

  it('validates EAN-13 (AHV check digit)', () => {
    expect(isValidEan13('7569217076985')).toBe(true);
    expect(isValidEan13('7569217076986')).toBe(false);
    expect(isValidEan13('75692170769')).toBe(false); // wrong length
  });
});

describe('emailDetector', () => {
  it('detects an email and lowercases only the domain', () => {
    const [c] = emailDetector.detect('Mail John.Doe@Example.COM please');
    expect(c.value).toBe('John.Doe@Example.COM');
    expect(c.normalized).toBe('John.Doe@example.com');
    expect(c.type).toBe('email');
    expect(c.confidence).toBe('high');
  });

  it('reports the correct range', () => {
    const text = 'x a@b.io';
    const [c] = emailDetector.detect(text);
    expect(text.slice(c.start, c.end)).toBe('a@b.io');
  });

  it('ignores text without an email', () => {
    expect(emailDetector.detect('no address here @ all')).toEqual([]);
  });
});

describe('ibanDetector', () => {
  it('detects a spaced IBAN and normalizes it', () => {
    const [c] = ibanDetector.detect('Pay IBAN GB82 WEST 1234 5698 7654 32 now');
    expect(c.value).toBe('GB82 WEST 1234 5698 7654 32');
    expect(c.normalized).toBe('GB82WEST12345698765432');
  });

  it('ignores IBAN-shaped strings with a bad checksum', () => {
    expect(ibanDetector.detect('GB00 WEST 1234 5698 7654 32')).toEqual([]);
  });
});

describe('creditCardDetector', () => {
  it('detects a Luhn-valid card', () => {
    const [c] = creditCardDetector.detect('card 4111 1111 1111 1111 exp');
    expect(c.normalized).toBe('4111111111111111');
  });

  it('ignores a Luhn-invalid number', () => {
    expect(creditCardDetector.detect('ref 4111 1111 1111 1112')).toEqual([]);
  });

  it('detects an Amex card by its IIN prefix', () => {
    const [c] = creditCardDetector.detect('amex 3782 822463 10005 ok');
    expect(c.normalized).toBe('378282246310005');
  });

  it('ignores short numbers', () => {
    expect(creditCardDetector.detect('extension 4521 today')).toEqual([]);
  });

  it('ignores a Luhn-valid number with no known card prefix', () => {
    // Passes Luhn but starts with 1 — not a real IIN, so not a card.
    expect(creditCardDetector.detect('id 1000000000000008 done')).toEqual([]);
  });
});

describe('swissAhvDetector', () => {
  it('detects a valid AHV number', () => {
    const [c] = swissAhvDetector.detect('AHV 756.9217.0769.85 on file');
    expect(c.normalized).toBe('7569217076985');
    expect(c.type).toBe('ch_ahv');
  });

  it('ignores a bad check digit', () => {
    expect(swissAhvDetector.detect('756.9217.0769.86')).toEqual([]);
  });
});

describe('ukNinoDetector', () => {
  it('detects a valid NINo', () => {
    const [c] = ukNinoDetector.detect('NINo AB 12 34 56 C here');
    expect(c.normalized).toBe('AB123456C');
  });

  it('rejects invalid prefixes', () => {
    expect(ukNinoDetector.detect('BG123456C')).toEqual([]); // disallowed prefix
    expect(ukNinoDetector.detect('DA123456C')).toEqual([]); // D invalid first letter
  });

  it('rejects invalid suffix', () => {
    expect(ukNinoDetector.detect('AB123456E')).toEqual([]);
  });
});

describe('secretDetector', () => {
  it('detects a PEM private-key block', () => {
    const pem =
      '-----BEGIN RSA PRIVATE KEY-----\nMIIBabc123\n-----END RSA PRIVATE KEY-----';
    const [c] = secretDetector.detect(`key:\n${pem}\nend`);
    expect(c.value).toBe(pem);
    expect(c.type).toBe('secret');
  });

  it('detects provider key prefixes', () => {
    expect(secretDetector.detect('token sk-abcdefghijklmnopqrstuvwx end').length).toBe(
      1,
    );
    expect(secretDetector.detect('aws AKIAIOSFODNN7EXAMPLE key').length).toBe(1);
  });

  it('ignores ordinary words', () => {
    expect(secretDetector.detect('please ask the desk for the key')).toEqual([]);
  });
});

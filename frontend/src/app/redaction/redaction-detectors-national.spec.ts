import { describe, expect, it } from 'vitest';

import {
  atSvnrDetector,
  deSteuerIdDetector,
  esDniDetector,
  esNieDetector,
  frNirDetector,
  isValidCodiceFiscale,
  isValidDni,
  isValidNhs,
  isValidNif,
  isValidNir,
  isValidPartitaIva,
  isValidSteuerId,
  isValidSvnr,
  itCodiceFiscaleDetector,
  itPartitaIvaDetector,
  phoneDetector,
  ptNifDetector,
  ukNhsDetector,
  usSsnDetector,
} from './redaction-detectors-national';
import { detectSensitiveText } from './redaction-engine';

// All "valid" vectors below are verified to pass their real checksum; the
// "invalid" ones genuinely fail (wrong checksum, wrong shape, or a structural
// rule). Sources: Wikipedia / python-stdnum / official references.

describe('national checksums', () => {
  it('UK NHS mod-11 (11→0, 10→invalid)', () => {
    expect(isValidNhs('9434765919')).toBe(true);
    expect(isValidNhs('4505577104')).toBe(true);
    expect(isValidNhs('9434765910')).toBe(false); // wrong check digit
  });

  it('France NIR mod-97 incl. Corsica 2A/2B', () => {
    expect(isValidNir('292077511300872')).toBe(true);
    expect(isValidNir('180013306312329')).toBe(true);
    expect(isValidNir('185032A00456765')).toBe(true); // Corsica 2A → 19
    expect(isValidNir('292077511300873')).toBe(false); // wrong key
  });

  it('Italy Codice Fiscale check character', () => {
    expect(isValidCodiceFiscale('RSSMRA85T10A562S')).toBe(true);
    expect(isValidCodiceFiscale('MRTMTT91D08F205J')).toBe(true);
    expect(isValidCodiceFiscale('RSSMRA85T10A562A')).toBe(false); // wrong check char
  });

  it('Italy Partita IVA Luhn-style', () => {
    expect(isValidPartitaIva('00743110157')).toBe(true);
    expect(isValidPartitaIva('07643520567')).toBe(true);
    expect(isValidPartitaIva('00743110158')).toBe(false); // wrong check
  });

  it('Germany Steuer-IdNr (checksum + structural rules)', () => {
    expect(isValidSteuerId('86095742719')).toBe(true); // one digit twice
    expect(isValidSteuerId('65929970489')).toBe(true); // one digit thrice
    expect(isValidSteuerId('02476291358')).toBe(false); // leading zero (structural)
    expect(isValidSteuerId('12345678928')).toBe(false); // wrong checksum
  });

  it('Austria SVNR (check digit at position 4 + date)', () => {
    expect(isValidSvnr('1237010180')).toBe(true);
    expect(isValidSvnr('1230010180')).toBe(false); // wrong check digit
    expect(isValidSvnr('1234567890')).toBe(false); // not a valid number/date
  });

  it('Portugal NIF mod-11 with valid leading digit', () => {
    expect(isValidNif('507306244')).toBe(true);
    expect(isValidNif('196807050')).toBe(true); // exercises the ≥10 → 0 branch
    expect(isValidNif('507306245')).toBe(false); // wrong check
    expect(isValidNif('407306244')).toBe(false); // invalid leading type digit
  });

  it('Spain DNI/NIE control letter', () => {
    expect(isValidDni('12345678', 'Z')).toBe(true);
    expect(isValidDni('00000001', 'R')).toBe(true);
    expect(isValidDni('12345678', 'A')).toBe(false);
  });
});

describe('usSsnDetector', () => {
  it('detects a dashed SSN and normalizes to digits (sunny)', () => {
    const [c] = usSsnDetector.detect('SSN 123-45-6789 on file');
    expect(c.type).toBe('us_ssn');
    expect(c.normalized).toBe('123456789');
  });

  it('ignores forbidden area/group/serial (rainy)', () => {
    expect(usSsnDetector.detect('666-45-6789')).toEqual([]); // area 666
    expect(usSsnDetector.detect('900-45-6789')).toEqual([]); // area 9xx
    expect(usSsnDetector.detect('123-00-6789')).toEqual([]); // group 00
    expect(usSsnDetector.detect('123-45-0000')).toEqual([]); // serial 0000
  });

  it('requires the dashed form (edge)', () => {
    expect(usSsnDetector.detect('order 123456789 shipped')).toEqual([]);
  });
});

describe('ukNhsDetector', () => {
  it('detects a grouped NHS number (sunny)', () => {
    const [c] = ukNhsDetector.detect('NHS 943 476 5919 registered');
    expect(c.type).toBe('uk_nhs');
    expect(c.normalized).toBe('9434765919');
  });

  it('rejects a bad checksum (rainy)', () => {
    expect(ukNhsDetector.detect('943 476 5910')).toEqual([]);
  });

  it('requires the 3-3-4 separators (edge)', () => {
    expect(ukNhsDetector.detect('phone 9434765919 here')).toEqual([]);
  });
});

describe('frNirDetector', () => {
  it('detects a spaced NIR and a Corsica NIR (sunny)', () => {
    const [a] = frNirDetector.detect('NIR 2 92 07 75 113 008 72 ok');
    expect(a.type).toBe('fr_nir');
    expect(a.normalized).toBe('292077511300872');

    const [b] = frNirDetector.detect('1 85 03 2A 004 567 65');
    expect(b.normalized).toBe('185032A00456765');
  });

  it('rejects a wrong control key (rainy)', () => {
    expect(frNirDetector.detect('2 92 07 75 113 008 73')).toEqual([]);
  });
});

describe('itCodiceFiscaleDetector', () => {
  it('detects a valid codice fiscale, any case (sunny + edge)', () => {
    const [c] = itCodiceFiscaleDetector.detect('CF rssmra85t10a562s here');
    expect(c.type).toBe('it_codice_fiscale');
    expect(c.normalized).toBe('RSSMRA85T10A562S');
  });

  it('rejects a wrong check character (rainy)', () => {
    expect(itCodiceFiscaleDetector.detect('RSSMRA85T10A562A')).toEqual([]);
  });
});

describe('itPartitaIvaDetector', () => {
  it('detects a valid Partita IVA (sunny)', () => {
    const [c] = itPartitaIvaDetector.detect('P.IVA 00743110157');
    expect(c.normalized).toBe('00743110157');
  });

  it('rejects a wrong checksum (rainy)', () => {
    expect(itPartitaIvaDetector.detect('00743110158')).toEqual([]);
  });
});

describe('deSteuerIdDetector', () => {
  it('detects valid IdNrs (sunny)', () => {
    expect(deSteuerIdDetector.detect('Steuer-ID 86095742719').length).toBe(1);
    expect(deSteuerIdDetector.detect('65929970489').length).toBe(1);
  });

  it('rejects leading-zero and bad-checksum numbers (rainy)', () => {
    expect(deSteuerIdDetector.detect('02476291358')).toEqual([]);
    expect(deSteuerIdDetector.detect('12345678928')).toEqual([]);
  });
});

describe('atSvnrDetector', () => {
  it('detects a valid SVNR (sunny)', () => {
    const [c] = atSvnrDetector.detect('SVNR 1237010180');
    expect(c.type).toBe('at_svnr');
  });

  it('rejects a wrong check digit (rainy)', () => {
    expect(atSvnrDetector.detect('1230010180')).toEqual([]);
  });
});

describe('ptNifDetector', () => {
  it('detects a valid NIF (sunny)', () => {
    const [c] = ptNifDetector.detect('NIF 507306244');
    expect(c.normalized).toBe('507306244');
  });

  it('rejects a wrong checksum (rainy)', () => {
    expect(ptNifDetector.detect('507306245')).toEqual([]);
  });
});

describe('esDniDetector / esNieDetector', () => {
  it('detects DNI and NIE, any case (sunny + edge)', () => {
    expect(esDniDetector.detect('DNI 12345678Z')[0].normalized).toBe('12345678Z');
    expect(esDniDetector.detect('dni 12345678z')[0].normalized).toBe('12345678Z');
    expect(esNieDetector.detect('NIE X1234567L')[0].normalized).toBe('X1234567L');
  });

  it('rejects wrong control letters (rainy)', () => {
    expect(esDniDetector.detect('12345678A')).toEqual([]);
    expect(esNieDetector.detect('X1234567Z')).toEqual([]);
  });
});

describe('phoneDetector', () => {
  it('detects E.164 numbers for the supported countries (sunny)', () => {
    for (const number of [
      '+14155552671',
      '+447911123456',
      '+33612345678',
      '+393123456789',
      '+4915123456789',
      '+41441234567',
      '+436641234567',
      '+351912345678',
      '+34612345678',
    ]) {
      expect(phoneDetector.detect(`call ${number} today`).length).toBe(1);
    }
  });

  it('normalizes a spaced number to E.164 (edge)', () => {
    const [c] = phoneDetector.detect('ring +41 44 123 45 67 please');
    expect(c.type).toBe('phone');
    expect(c.normalized).toBe('+41441234567');
  });

  it('ignores bare national numbers and wrong lengths (rainy)', () => {
    expect(phoneDetector.detect('4155552671')).toEqual([]); // no + prefix
    expect(phoneDetector.detect('+12')).toEqual([]); // too short
    expect(phoneDetector.detect('+12345678901234567890')).toEqual([]); // too long
  });
});

describe('engine registration', () => {
  it('finds national identifiers through detectSensitiveText', () => {
    const text =
      'DNI 12345678Z, NIF 507306244, NHS 943 476 5919 and phone +34612345678';
    const types = detectSensitiveText(text)
      .map((c) => c.type)
      .sort();
    expect(types).toEqual(['es_dni', 'phone', 'pt_nif', 'uk_nhs']);
  });

  it('does not redact ordinary prose with numbers', () => {
    const text = 'We shipped 1500 units on 2026-06-21 for order 4567 at 12:30.';
    expect(detectSensitiveText(text)).toEqual([]);
  });
});

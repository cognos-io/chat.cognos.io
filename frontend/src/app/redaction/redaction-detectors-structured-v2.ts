import { candidate, matchAll } from './redaction-detector-utils';
import { Detector, RedactionCandidate } from './redaction-types';

const PASSPORT_RE =
  /\b(?:passport|pass|passeport|pasaporte|passaporte|passaporto)\s*(?:no\.?|nr\.?|#|:)?\s*(CH\s*)?[A-Z]\d{7}\b/gi;

export const passportDetector: Detector = {
  id: 'passport:v1',
  type: 'passport',
  detect(text) {
    const out: RedactionCandidate[] = [];
    for (const m of matchAll(text, PASSPORT_RE)) {
      const value = m[0];
      const matched = value.match(/(CH\s*)?[A-Z]\d{7}\b/i)?.[0];
      if (!matched) continue;
      out.push(
        candidate(
          'passport',
          'passport:v1',
          m,
          matched,
          matched.replace(/\s+/g, '').toUpperCase(),
        ),
      );
    }
    return out;
  },
};

const CH_DRIVING_RE =
  /\b(?:licen[cs]e|driving|f[üu]hrerausweis|fuehrerausweis|permis|permiso|carta)\b[^\d]{0,24}\d{9}\b/gi;

export const chDrivingLicenceDetector: Detector = {
  id: 'ch-driving:v1',
  type: 'ch_driving_licence',
  detect(text) {
    const out: RedactionCandidate[] = [];
    for (const m of matchAll(text, CH_DRIVING_RE)) {
      const value = m[0];
      const digits = value.match(/\d{9}\b/)?.[0];
      if (!digits) continue;
      out.push(candidate('ch_driving_licence', 'ch-driving:v1', m, digits, digits));
    }
    return out;
  },
};

const POSTFINANCE_RE =
  /\b(?:postfinance|postal|bank|account|konto|compte|cuenta|conta|conto)\b[^\d]{0,24}\d{2}-\d{3,6}-\d\b/gi;

export const chPostFinanceDetector: Detector = {
  id: 'ch-postfinance:v1',
  type: 'ch_postfinance',
  detect(text) {
    const out: RedactionCandidate[] = [];
    for (const m of matchAll(text, POSTFINANCE_RE)) {
      const value = m[0];
      const number = value.match(/\d{2}-\d{3,6}-\d\b/)?.[0];
      if (!number) continue;
      out.push(candidate('ch_postfinance', 'ch-postfinance:v1', m, number, number));
    }
    return out;
  },
};

export const STRUCTURED_V2_DETECTORS: readonly Detector[] = [
  passportDetector,
  chDrivingLicenceDetector,
  chPostFinanceDetector,
];

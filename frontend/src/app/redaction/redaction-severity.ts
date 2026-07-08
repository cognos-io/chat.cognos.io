import { REDACTION_TYPES, RedactionType } from './redaction-types';

export type RedactionSeverity = 'low' | 'medium' | 'high' | 'critical';

export const REDACTION_SEVERITY_ORDER: readonly RedactionSeverity[] = [
  'critical',
  'high',
  'medium',
  'low',
];

const SEVERITY_BY_TYPE: Record<RedactionType, RedactionSeverity> = {
  secret: 'critical',
  credit_card: 'high',
  iban: 'high',
  ch_postfinance: 'high',
  passport: 'high',
  ch_driving_licence: 'high',
  dob: 'high',
  health: 'high',
  us_ssn: 'high',
  uk_nhs: 'high',
  fr_nir: 'high',
  it_codice_fiscale: 'high',
  it_partita_iva: 'high',
  de_steuer_id: 'high',
  ch_ahv: 'high',
  at_svnr: 'high',
  pt_nif: 'high',
  es_dni: 'high',
  es_nie: 'high',
  phone: 'medium',
  uk_nino: 'medium',
  ip_address: 'medium',
  person: 'medium',
  org: 'medium',
  place: 'medium',
  email: 'low',
  custom: 'low',
};

// Compile-time exhaustiveness plus a runtime guard for future additions.
for (const type of REDACTION_TYPES) {
  if (!SEVERITY_BY_TYPE[type]) {
    throw new Error(`Missing redaction severity for ${type}`);
  }
}

export function redactionSeverity(type: RedactionType): RedactionSeverity {
  return SEVERITY_BY_TYPE[type];
}

export function compareRedactionSeverity(a: RedactionType, b: RedactionType): number {
  return compareSeverity(redactionSeverity(a), redactionSeverity(b));
}

export function compareSeverity(a: RedactionSeverity, b: RedactionSeverity): number {
  return REDACTION_SEVERITY_ORDER.indexOf(a) - REDACTION_SEVERITY_ORDER.indexOf(b);
}

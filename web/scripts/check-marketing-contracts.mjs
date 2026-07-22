import { readFile } from 'node:fs/promises';

const locales = ['en', 'de', 'fr', 'es', 'pt', 'it'];
const supportResponsePhrases = {
  en: 'one working week',
  de: 'einer Arbeitswoche',
  fr: 'une semaine ouvrée',
  es: 'una semana laborable',
  pt: 'uma semana útil',
  it: 'una settimana lavorativa',
};
const designPartnerPhrases = {
  en: 'design partners',
  de: 'Designpartner',
  fr: 'partenaires pilotes',
  es: 'colaboradores piloto',
  pt: 'parceiros-piloto',
  it: 'partner pilota',
};
const unshippedTeamPhrases = {
  en: ['coming soon', "we're building", 'will include'],
  de: ['bald verfügbar', 'wir bauen', 'ist geplant'],
  fr: ['bientôt disponible', 'nous préparons', 'est prévu'],
  es: ['próximamente', 'estamos preparando', 'incluirá'],
  pt: ['brevemente', 'estamos a preparar', 'vai incluir'],
  it: ['in arrivo', 'stiamo preparando', 'includerà'],
};
const localeDirectory = new URL('../src/i18n/locales/', import.meta.url);
const pricingSource = await readFile(
  new URL('../../frontend/src/app/billing/pricing.ts', import.meta.url),
  'utf8',
);
const billingRunbook = await readFile(
  new URL('../../docs/billing-ops-runbook.md', import.meta.url),
  'utf8',
);

const requiredPrices = ['CHF 15', 'CHF 150', 'CHF 45'];
for (const price of requiredPrices) {
  if (!pricingSource.includes(price) || !billingRunbook.includes(price)) {
    throw new Error(`Canonical billing sources disagree about ${price}`);
  }
}

if (!pricingSource.includes('orgSeatMinimum: 3')) {
  throw new Error('pricing.ts must declare orgSeatMinimum: 3');
}

if (!pricingSource.includes("CHF 1'500") || !billingRunbook.includes("CHF 1'500")) {
  throw new Error("Canonical billing sources disagree about CHF 1'500");
}

for (const locale of locales) {
  const catalogue = JSON.parse(
    await readFile(new URL(`${locale}.json`, localeDirectory), 'utf8'),
  );
  const payg = catalogue.audience.individuals;
  const unlimited = catalogue.audience.business;

  if (payg.currency !== 'CHF' || payg.amount !== '15') {
    throw new Error(`${locale}: PAYG must show the CHF 15 monthly minimum`);
  }
  if (unlimited.currency !== 'CHF' || unlimited.amount !== '150') {
    throw new Error(`${locale}: Unlimited monthly must show CHF 150`);
  }
  if (!unlimited.annual.includes('CHF 1500')) {
    throw new Error(`${locale}: Unlimited annual must show CHF 1500`);
  }
  if (!payg.items.at(-1)?.includes('CHF 15')) {
    throw new Error(`${locale}: PAYG must not imply that an unused billing month is free`);
  }

  if (!catalogue.audience.roadmap.includes('CHF 45')) {
    throw new Error(`${locale}: team roadmap must mention the CHF 45 three-seat minimum`);
  }
  const teamPoint = catalogue.pages.business.team.points[0];
  if (!teamPoint.includes('CHF 45')) {
    throw new Error(`${locale}: team pricing point must mention the CHF 45 three-seat minimum`);
  }

  const teamAvailabilityCopy = [
    catalogue.audience.roadmap,
    catalogue.pages.business.team.title,
    catalogue.pages.business.team.lead,
  ];
  for (const copy of teamAvailabilityCopy) {
    if (!copy.includes(designPartnerPhrases[locale])) {
      throw new Error(`${locale}: Teams must be described as available to design partners`);
    }
  }
  const combinedTeamAvailabilityCopy = teamAvailabilityCopy.join(' ').toLowerCase();
  for (const phrase of unshippedTeamPhrases[locale]) {
    if (combinedTeamAvailabilityCopy.includes(phrase)) {
      throw new Error(`${locale}: Teams must not be described as unshipped (${phrase})`);
    }
  }

  const supportCopy = [catalogue.pages.business.form.note, catalogue.pages.contact.channels[0].body];
  for (const copy of supportCopy) {
    if (!copy.includes(supportResponsePhrases[locale])) {
      throw new Error(`${locale}: support response target must be one working week`);
    }
  }
}

/** Flatten nested object keys into dotted paths for catalogue-key parity.
 * Arrays are compared as present/absent only (`path[]`).
 *
 * Privacy/terms body arrays (`facts`, `intro`, `sections`) may be absent in
 * non-English catalogues on purpose: `useTranslations().raw` falls back to
 * English until native-speaker / counsel copy lands (OP-015). Do not add empty
 * `[]` stubs — empty arrays are truthy and block that fallback. */
function collectKeys(value, prefix = '') {
  if (Array.isArray(value)) {
    return [prefix ? `${prefix}[]` : '[]'];
  }
  if (value !== null && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .flatMap((key) => collectKeys(value[key], prefix ? `${prefix}.${key}` : key));
  }
  return [prefix];
}

/** Keys that may be English-only until OP-015 / counsel translation. */
const optionalUntilTranslated = new Set([
  'pages.privacy.facts[]',
  'pages.privacy.intro[]',
  'pages.privacy.sections[]',
  'pages.terms.facts[]',
  'pages.terms.intro[]',
  'pages.terms.sections[]',
]);

const englishCatalogue = JSON.parse(
  await readFile(new URL('en.json', localeDirectory), 'utf8'),
);
const englishKeys = collectKeys(englishCatalogue).sort();

for (const locale of locales) {
  if (locale === 'en') {
    continue;
  }
  const catalogue = JSON.parse(
    await readFile(new URL(`${locale}.json`, localeDirectory), 'utf8'),
  );
  const keys = collectKeys(catalogue).sort();
  const missing = englishKeys.filter(
    (key) => !keys.includes(key) && !optionalUntilTranslated.has(key),
  );
  const extra = keys.filter((key) => !englishKeys.includes(key));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `${locale}: catalogue key tree must match en.json` +
        (missing.length ? `; missing ${missing.slice(0, 5).join(', ')}` : '') +
        (extra.length ? `; extra ${extra.slice(0, 5).join(', ')}` : ''),
    );
  }

  // Empty arrays are truthy and block useTranslations().raw English fallback.
  for (const path of optionalUntilTranslated) {
    const parts = path.replace(/\[\]$/, '').split('.');
    let cursor = catalogue;
    for (const part of parts) {
      cursor = cursor?.[part];
    }
    if (Array.isArray(cursor) && cursor.length === 0) {
      throw new Error(
        `${locale}: ${path} must be omitted (not []) so English legal body fallback works until OP-015`,
      );
    }
  }
}

console.log('Marketing pricing, support and catalogue-key parity checks passed.');

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

console.log('Marketing pricing and support contract checks passed.');

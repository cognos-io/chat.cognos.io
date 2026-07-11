import { readFile } from 'node:fs/promises';

const locales = ['en', 'de', 'fr', 'es', 'pt', 'it'];
const localeDirectory = new URL('../src/i18n/locales/', import.meta.url);
const pricingSource = await readFile(
  new URL('../../frontend/src/app/billing/pricing.ts', import.meta.url),
  'utf8',
);
const billingRunbook = await readFile(
  new URL('../../docs/billing-ops-runbook.md', import.meta.url),
  'utf8',
);

const requiredPrices = ['CHF 15', 'CHF 150'];
for (const price of requiredPrices) {
  if (!pricingSource.includes(price) || !billingRunbook.includes(price)) {
    throw new Error(`Canonical billing sources disagree about ${price}`);
  }
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
}

console.log('Marketing pricing contract checks passed.');

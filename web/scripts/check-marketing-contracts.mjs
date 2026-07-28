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
    throw new Error(
      `${locale}: PAYG must not imply that an unused billing month is free`,
    );
  }

  if (!catalogue.audience.roadmap.includes('CHF 45')) {
    throw new Error(
      `${locale}: team roadmap must mention the CHF 45 three-seat minimum`,
    );
  }
  const teamPoint = catalogue.pages.business.team.points[0];
  if (!teamPoint.includes('CHF 45')) {
    throw new Error(
      `${locale}: team pricing point must mention the CHF 45 three-seat minimum`,
    );
  }

  const teamAvailabilityCopy = [
    catalogue.audience.roadmap,
    catalogue.pages.business.team.title,
    catalogue.pages.business.team.lead,
  ];
  for (const copy of teamAvailabilityCopy) {
    if (!copy.includes(designPartnerPhrases[locale])) {
      throw new Error(
        `${locale}: Teams must be described as available to design partners`,
      );
    }
  }
  const combinedTeamAvailabilityCopy = teamAvailabilityCopy.join(' ').toLowerCase();
  for (const phrase of unshippedTeamPhrases[locale]) {
    if (combinedTeamAvailabilityCopy.includes(phrase)) {
      throw new Error(
        `${locale}: Teams must not be described as unshipped (${phrase})`,
      );
    }
  }

  const supportCopy = [
    catalogue.pages.business.form.note,
    catalogue.pages.contact.channels[0].body,
  ];
  for (const copy of supportCopy) {
    if (!copy.includes(supportResponsePhrases[locale])) {
      throw new Error(`${locale}: support response target must be one working week`);
    }
  }
}

// Blog copy follows the same plain-language rule as the rest of the marketing
// site (root CLAUDE.md): write for non-technical readers and never reach for
// crypto jargon. The blog is the easiest place for it to creep back in, because
// posts explain mechanisms, so the ban is enforced rather than remembered.
const bannedBlogJargon = {
  en: ['end-to-end', 'zero-knowledge', 'zero knowledge', 'ciphertext', 'plaintext'],
  de: ['ende-zu-ende', 'zero-knowledge', 'geheimtext', 'klartext'],
  fr: [
    'de bout en bout',
    'zero-knowledge',
    'chiffré de bout',
    'texte chiffré',
    'texte clair',
  ],
  es: ['de extremo a extremo', 'zero-knowledge', 'texto cifrado', 'texto plano'],
  pt: ['de ponta a ponta', 'zero-knowledge', 'texto cifrado', 'texto simples'],
  it: ['end-to-end', 'zero-knowledge', 'testo cifrato', 'testo in chiaro'],
};

/** Every field a post needs before it can render. */
const requiredPostFields = [
  'title',
  'metaTitle',
  'metaDescription',
  'lead',
  'time',
  'heroAlt',
  'sections',
];

for (const locale of locales) {
  const catalogue = JSON.parse(
    await readFile(new URL(`${locale}.json`, localeDirectory), 'utf8'),
  );
  const blog = catalogue.blog;
  if (!blog?.posts || Object.keys(blog.posts).length === 0) {
    throw new Error(`${locale}: the blog catalogue must carry at least one post`);
  }

  for (const [slug, post] of Object.entries(blog.posts)) {
    for (const field of requiredPostFields) {
      if (!post[field] || (Array.isArray(post[field]) && post[field].length === 0)) {
        throw new Error(`${locale}: blog post "${slug}" is missing ${field}`);
      }
    }
    // Images carry meaning here, so every one needs its own description.
    for (const section of post.sections) {
      for (const block of section.blocks) {
        for (const image of block.gallery?.images ?? []) {
          if (!image.alt) {
            throw new Error(`${locale}: a gallery image in "${slug}" has no alt text`);
          }
        }
        if (block.figure && !block.figure.alt) {
          throw new Error(`${locale}: a figure in "${slug}" has no alt text`);
        }
      }
    }
  }

  const blogCopy = JSON.stringify(blog).toLowerCase();
  for (const phrase of bannedBlogJargon[locale]) {
    if (blogCopy.includes(phrase)) {
      throw new Error(
        `${locale}: blog copy must avoid crypto jargon - found "${phrase}". Say what it means instead.`,
      );
    }
  }
}

/** Flatten nested object keys into dotted paths for catalogue-key parity.
 * Arrays are compared as present/absent only (`path[]`).
 *
 * Privacy/terms body arrays are absent in non-English catalogues on purpose; see
 * `englishOnlyLegalBodies` below. */
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

/** The body arrays every legal page is built from. */
const legalBodyFields = ['facts', 'intro', 'sections'];

/**
 * Legal pages that ship in English only for now, by decision rather than by
 * omission.
 *
 * Privacy and Terms are drafted with counsel. A mistranslated warranty
 * disclaimer or data-processing claim is legal exposure, not a UX papercut, so
 * these are not translated speculatively; they wait for counsel-reviewed copy in
 * each language. `useTranslations().raw` falls back to English for a missing key,
 * so a French reader gets the English body rather than a blank page.
 *
 * Shipping English here is a decision, not a backlog item: the open point that
 * tracked it was closed on that basis (see the note under "Blocked external /
 * manual" in docs/open-points.md, and docs/i18n.md).
 *
 * PIN: asserted in both directions below - present in `en`, absent everywhere
 * else. Absent rather than merely optional, because an empty `[]` stub is truthy
 * and would block the English fallback, and because a translation appearing here
 * must be a deliberate decision taken with counsel. If that decision is made,
 * update this list in the same commit as the copy.
 */
const englishOnlyLegalBodies = ['pages.privacy', 'pages.terms'];

/**
 * Legal pages that must be translated everywhere.
 *
 * Refund is the page a customer reads to find out whether they get their money
 * back, and Paddle payment verification depends on it matching the published
 * policy in every market we sell to - so an English fallback here is a real
 * problem, not a cosmetic one. Translated in all six as of July 2026.
 */
const translatedLegalBodies = ['pages.refund'];

/** Read a dotted path out of a catalogue. */
function at(catalogue, path) {
  return path.split('.').reduce((cursor, part) => cursor?.[part], catalogue);
}

const optionalUntilTranslated = new Set(
  englishOnlyLegalBodies.flatMap((page) =>
    legalBodyFields.map((field) => `${page}.${field}[]`),
  ),
);

/** Key subtrees translated incrementally, English-only until native copy lands.
 * The documentation catalogue (`docs.*`) ships English first and is translated
 * page-by-page; `useTranslations().raw` falls back to English for any key a
 * locale has not yet filled in. Same rationale as the legal bodies above - a
 * locale may omit these keys (never stub them as empty arrays, which are truthy
 * and would block the English fallback). */
const optionalKeyPrefixes = ['docs.'];
const isOptionalKey = (key) =>
  optionalUntilTranslated.has(key) ||
  optionalKeyPrefixes.some((prefix) => key.startsWith(prefix));

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
    (key) => !keys.includes(key) && !isOptionalKey(key),
  );
  const extra = keys.filter((key) => !englishKeys.includes(key) && !isOptionalKey(key));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `${locale}: catalogue key tree must match en.json` +
        (missing.length ? `; missing ${missing.slice(0, 5).join(', ')}` : '') +
        (extra.length ? `; extra ${extra.slice(0, 5).join(', ')}` : ''),
    );
  }

  // PIN: the English-only legal bodies must be absent here, not empty and not
  // translated. See englishOnlyLegalBodies for why, and update it deliberately
  // if counsel-reviewed copy lands in this language.
  for (const page of englishOnlyLegalBodies) {
    for (const field of legalBodyFields) {
      const value = at(catalogue, `${page}.${field}`);
      if (value === undefined) continue;
      if (Array.isArray(value) && value.length === 0) {
        throw new Error(
          `${locale}: ${page}.${field} must be omitted, not [] - an empty array is truthy and blocks the English fallback`,
        );
      }
      throw new Error(
        `${locale}: ${page}.${field} is translated, but ${page} ships in English only. ` +
          'If counsel has reviewed this language, remove the page from englishOnlyLegalBodies in the same commit.',
      );
    }
  }
}

// Refund must be translated in every locale, English included. Asserted
// positively so the translations cannot be quietly dropped the way a catalogue
// subtree can go missing without anything failing.
for (const locale of locales) {
  const catalogue = JSON.parse(
    await readFile(new URL(`${locale}.json`, localeDirectory), 'utf8'),
  );
  for (const page of translatedLegalBodies) {
    for (const field of legalBodyFields) {
      const value = at(catalogue, `${page}.${field}`);
      if (!Array.isArray(value) || value.length === 0) {
        throw new Error(
          `${locale}: ${page}.${field} must be a non-empty array - ${page} ships translated in all six locales`,
        );
      }
    }
  }
}

console.log('Marketing pricing, support and catalogue-key parity checks passed.');

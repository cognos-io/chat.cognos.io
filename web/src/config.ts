// Where the marketing CTAs point. The app is planned at app.cognos.io
// (see the product's hosting plan); adjust here if that changes.
export const APP_URL = 'https://app.cognos.io';
export const SIGN_IN_URL = `${APP_URL}/auth/login`;
export const SIGN_UP_URL = `${APP_URL}/auth/register`;

// Coarse CTA placement labels, mirrored in the analytics spec
// (docs/business_processes/product-analytics.md). Never a visitor identifier.
export type CtaLocation =
  | 'navbar'
  | 'hero'
  | 'how_it_works'
  | 'pricing_individuals'
  | 'pricing_business'
  | 'cta_individuals'
  | 'cta_business'
  | 'redaction'
  | 'about'
  | 'contact'
  | 'blog'
  | 'footer';

/** Signup URL carrying the CTA placement, so the app can attribute signups. */
export function signUpUrl(location: CtaLocation): string {
  return `${SIGN_UP_URL}?ref=${location}`;
}

// Contact channels, in the order they appear on /contact. One shared inbox -
// topic labels still differentiate sales / security / press in the UI.
export const CONTACT_EMAILS = {
  support: 'support@cognos.io',
} as const;

// Legal entity behind Cognos, shown in the /contact imprint (legal notice) and
// the legal pages. Same in every locale, so it lives here rather than in the
// i18n catalogs. `uid` is the Swiss company identifier; `registerUrl` opens the
// official commercial-register extract.
export const COMPANY = {
  legalName: 'Climacrux GmbH',
  addressLines: ['St. Niklausenstrasse 96', '6047 Kastanienbaum', 'Switzerland'],
  uid: 'CHE-372.115.477',
  registerUrl:
    'https://lu.chregister.ch/cr-portal/auszug/auszug.xhtml?uid=CHE-372.115.477#',
} as const;

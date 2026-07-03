// Where the marketing CTAs point. The app is planned at app.cognos.io
// (see the product's hosting plan); adjust here if that changes.
export const APP_URL = 'https://app.cognos.io';
export const SIGN_IN_URL = `${APP_URL}/auth/login`;
export const SIGN_UP_URL = `${APP_URL}/auth/register`;

// Coarse CTA placement labels, mirrored in the analytics spec
// (docs/specs/product-analytics.md §5.3). Never a visitor identifier.
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
  | 'footer';

/** Signup URL carrying the CTA placement, so the app can attribute signups. */
export function signUpUrl(location: CtaLocation): string {
  return `${SIGN_UP_URL}?ref=${location}`;
}

// Contact channels, in the order they appear on /contact. The addresses live
// here (not in the i18n catalogs) because they are the same in every locale.
export const CONTACT_EMAILS = {
  support: 'support@cognos.io',
  sales: 'sales@cognos.io',
  security: 'security@cognos.io',
  press: 'press@cognos.io',
} as const;

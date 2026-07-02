// Where the marketing CTAs point. The app is planned at app.cognos.io
// (see the product's hosting plan); adjust here if that changes.
export const APP_URL = 'https://app.cognos.io';
export const SIGN_IN_URL = `${APP_URL}/login`;
export const SIGN_UP_URL = `${APP_URL}/signup`;
export const BUSINESS_URL = `${APP_URL}/business`;

// Contact channels, in the order they appear on /contact. The addresses live
// here (not in the i18n catalogs) because they are the same in every locale.
export const CONTACT_EMAILS = {
  support: 'support@cognos.io',
  sales: 'sales@cognos.io',
  security: 'security@cognos.io',
  press: 'press@cognos.io',
} as const;

// Currency display helpers. Billing wires carry integer rappen (CHF cents);
// the UI shows francs in the house format "CHF 12.34" (matching the inline
// formatting used across the personal billing pages).

/** chfFromRappen renders integer rappen as "CHF X.XX". */
export function chfFromRappen(rappen: number): string {
  return `CHF ${(rappen / 100).toFixed(2)}`;
}

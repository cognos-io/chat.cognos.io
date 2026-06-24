import { parseBackendDate } from './timestamp';

// A relative-date bucket resolved from a timestamp. Translation keys live under
// `common.relativeDate.*`; `absolute` is a pre-formatted YYYY/MM/DD fallback for
// anything older than a fortnight (no translation needed).
export type RelativeDateResult =
  | { key: 'common.relativeDate.today' }
  | { key: 'common.relativeDate.yesterday' }
  | { key: 'common.relativeDate.daysAgo'; params: { count: number } }
  | { key: 'common.relativeDate.lastWeek' }
  | { absolute: string };

// Buckets a timestamp by whole calendar days from `now`:
//   0 → today · 1 → yesterday · 2–6 → "N days ago" · 7–13 → last week ·
//   otherwise the absolute YYYY/MM/DD date.
// Returns null for missing/unparseable input.
export function relativeDate(
  value: string | Date | undefined | null,
  now: Date = new Date(),
): RelativeDateResult | null {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : parseBackendDate(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);

  if (days <= 0) {
    return { key: 'common.relativeDate.today' };
  }
  if (days === 1) {
    return { key: 'common.relativeDate.yesterday' };
  }
  if (days <= 6) {
    return { key: 'common.relativeDate.daysAgo', params: { count: days } };
  }
  if (days <= 13) {
    return { key: 'common.relativeDate.lastWeek' };
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return { absolute: `${year}/${month}/${day}` };
}

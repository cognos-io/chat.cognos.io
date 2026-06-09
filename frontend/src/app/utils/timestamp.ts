export function isTimestampInMilliseconds(timestamp: number) {
  // Timestamps in seconds since Unix epoch time will be 10 digits
  // Timestamps in milliseconds since Unix epoch time will be 13 digits
  return timestamp.toString().length === 13;
}

/**
 * Parse a timestamp string returned by the backend into a Date.
 *
 * PocketBase serialises timestamps as "2006-01-02 15:04:05.000Z" — a space
 * separates the date and time rather than the ISO-8601 "T". Chrome's Date
 * parser tolerates the space, but Safari and Firefox return an Invalid Date,
 * which then throws when handed to Angular's DatePipe. Swapping the first
 * space for a "T" makes the string ISO-8601 so it parses in every browser;
 * already-ISO strings (and missing values) are handled too.
 */
export function parseBackendDate(value: string | null | undefined): Date {
  if (!value) {
    return new Date(NaN);
  }

  return new Date(value.replace(' ', 'T'));
}

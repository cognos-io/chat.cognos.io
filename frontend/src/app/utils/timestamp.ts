export function isTimestampInMilliseconds(timestamp: number) {
  // Timestamps in seconds since Unix epoch time will be 10 digits
  // Timestamps in milliseconds since Unix epoch time will be 13 digits
  return timestamp.toString().length === 13;
}

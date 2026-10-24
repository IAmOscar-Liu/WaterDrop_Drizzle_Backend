const DAY_MS = 24 * 60 * 60 * 1000;
// Business timezone: Asia/Taipei (UTC+08:00), independent of the server's TZ.
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

/** Orders created strictly before this instant are due for expiry.
 * Payment-processing orders expire at midnight after the next Taiwan day ends.
 */
export function paymentProcessingExpiryCutoff(now: Date): Date {
  const localTime = now.getTime() + TAIPEI_OFFSET_MS;
  if (!Number.isFinite(localTime)) throw new Error("Invalid order expiry time");
  const localMidnight = Math.floor(localTime / DAY_MS) * DAY_MS;
  return new Date(localMidnight - TAIPEI_OFFSET_MS - DAY_MS);
}

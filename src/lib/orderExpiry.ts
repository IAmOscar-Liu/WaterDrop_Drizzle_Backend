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

/** ECPay ATM dates are Taiwan local time; date-only deadlines include that whole day. */
export function atmPaymentDeadline(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})\/(\d{2})\/(\d{2})(?: (\d{2}):(\d{2}):(\d{2}))?$/.exec(value);
  if (!match) return null;
  const [, y, m, d, h, minute, second] = match;
  const utc = Date.UTC(Number(y), Number(m) - 1, Number(d), Number(h ?? 0), Number(minute ?? 0), Number(second ?? 0));
  const check = new Date(utc);
  if (check.getUTCFullYear() !== Number(y) || check.getUTCMonth() !== Number(m) - 1
    || check.getUTCDate() !== Number(d) || check.getUTCHours() !== Number(h ?? 0)
    || check.getUTCMinutes() !== Number(minute ?? 0) || check.getUTCSeconds() !== Number(second ?? 0)) return null;
  return new Date(utc - TAIPEI_OFFSET_MS + (h === undefined ? DAY_MS : 0));
}

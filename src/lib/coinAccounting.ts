export const COIN_SCALE = 100;
export const COINS_PER_CURRENCY_UNIT = 10;
export const AD_VIEW_CHARGE = 1.5;
export const AD_VIEW_FUNDED_COINS = 15;
export const PLATFORM_TIMEZONE = "Asia/Taipei";

export function isCoinLedgerEnabled() {
  return process.env.COIN_LEDGER_ENABLED === "true";
}

export function toCoinUnits(value: number | string) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`Invalid coin amount: ${value}`);
  }
  return Math.round((numeric + Number.EPSILON) * COIN_SCALE);
}

export function fromCoinUnits(units: number) {
  return (units / COIN_SCALE).toFixed(2);
}

export function decimalAmount(value: number | string) {
  return fromCoinUnits(toCoinUnits(value));
}

export function isValidTimezone(timezone?: string | null) {
  if (!timezone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

export function effectiveTimezone(timezone?: string | null) {
  return isValidTimezone(timezone) ? timezone! : PLATFORM_TIMEZONE;
}

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export function getZonedParts(date: Date, timezone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return values as ZonedParts;
}

export function getLocalDate(date: Date, timezone: string) {
  const { year, month, day } = getZonedParts(date, timezone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function getLocalMonth(date: Date, timezone: string) {
  return getLocalDate(date, timezone).slice(0, 7);
}

function zonedDateTimeToUtc(parts: ZonedParts, timezone: string) {
  const wanted = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  let candidate = wanted;
  for (let i = 0; i < 4; i += 1) {
    const actual = getZonedParts(new Date(candidate), timezone);
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    const delta = wanted - actualAsUtc;
    candidate += delta;
    if (delta === 0) break;
  }
  return new Date(candidate);
}

export function getNextLocalMidnight(date: Date, timezone: string) {
  const local = getZonedParts(date, timezone);
  const nextDate = new Date(Date.UTC(local.year, local.month - 1, local.day + 1));
  return zonedDateTimeToUtc(
    {
      year: nextDate.getUTCFullYear(),
      month: nextDate.getUTCMonth() + 1,
      day: nextDate.getUTCDate(),
      hour: 0,
      minute: 0,
      second: 0,
    },
    timezone,
  );
}

export function getEndOfNextLocalMonth(date: Date, timezone: string) {
  const local = getZonedParts(date, timezone);
  const firstAfterNextMonth = new Date(
    Date.UTC(local.year, local.month + 1, 1),
  );
  return zonedDateTimeToUtc(
    {
      year: firstAfterNextMonth.getUTCFullYear(),
      month: firstAfterNextMonth.getUTCMonth() + 1,
      day: 1,
      hour: 0,
      minute: 0,
      second: 0,
    },
    timezone,
  );
}

export function earlierDate(...dates: Array<Date | null | undefined>) {
  const present = dates.filter((date): date is Date => Boolean(date));
  return present.reduce((earliest, date) =>
    date.getTime() < earliest.getTime() ? date : earliest,
  );
}

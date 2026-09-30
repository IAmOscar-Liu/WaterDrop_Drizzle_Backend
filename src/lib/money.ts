const MONEY_PATTERN = /^(?:0|[1-9]\d{0,15})(?:\.(\d{1,2}))?$/;

export function normalizeMoney(value: string | number): string {
  const raw = typeof value === "number" ? normalizeMoneyNumber(value) : value.trim();
  const match = MONEY_PATTERN.exec(raw);
  if (!match) {
    throw new Error("Amount must be a non-negative decimal with at most two decimal places.");
  }

  const [whole, fraction = ""] = raw.split(".");
  return `${whole}.${fraction.padEnd(2, "0")}`;
}

function normalizeMoneyNumber(value: number): string {
  if (!Number.isFinite(value) || value < 0 || value > 9_999_999_999_999_999) {
    throw new Error("Amount is outside the supported currency range.");
  }

  const rounded = value.toFixed(2);
  if (!Number.isSafeInteger(Math.round(value * 100))) {
    throw new Error("Use a decimal string for amounts outside the safe number range.");
  }
  if (Math.abs(Number(rounded) - value) > Number.EPSILON * Math.max(1, value) * 4) {
    throw new Error("Amount must have at most two decimal places.");
  }
  return rounded;
}

export function isPositiveMoney(value: string | number): boolean {
  try {
    return moneyToMinorUnits(normalizeMoney(value)) > BigInt(0);
  } catch {
    return false;
  }
}

export function moneyToMinorUnits(value: string | number): bigint {
  const normalized = normalizeMoney(value);
  const [whole, fraction] = normalized.split(".");
  return BigInt(whole) * BigInt(100) + BigInt(fraction);
}

export function minorUnitsToMoney(value: bigint): string {
  const negative = value < BigInt(0);
  const absolute = negative ? -value : value;
  const whole = absolute / BigInt(100);
  const fraction = (absolute % BigInt(100)).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

export function addMoney(left: string | number, right: string | number): string {
  return minorUnitsToMoney(moneyToMinorUnits(left) + moneyToMinorUnits(right));
}

export function subtractMoney(
  left: string | number,
  right: string | number,
): string {
  return minorUnitsToMoney(moneyToMinorUnits(left) - moneyToMinorUnits(right));
}

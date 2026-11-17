import { CustomError } from "./error";
import { isLocalOrDevelopment } from "./env";

// Six decimals in TWD-equivalent; coin amounts convert at ten coins per TWD.
export const UNIT = BigInt(1000000);
export function units(value: string | number): bigint {
  const raw = String(value);
  if (!/^-?\d{1,16}(\.\d{1,6})?$/.test(raw)) throw new CustomError("Invalid exact amount", 400);
  const [whole, fraction = ""] = raw.replace("-", "").split(".");
  return (BigInt(whole) * UNIT + BigInt(fraction.padEnd(6, "0"))) * (raw.startsWith("-") ? -BigInt(1) : BigInt(1));
}
export function amount(value: bigint): string {
  const abs = value < BigInt(0) ? -value : value;
  return `${value < BigInt(0) ? "-" : ""}${abs / UNIT}.${String(abs % UNIT).padStart(6, "0")}`;
}
export function min(a: bigint, b: bigint) { return a < b ? a : b; }
export function earningsHoldMs() { return 14 * 86400_000 / (isLocalOrDevelopment() ? 10 : 1); }
export function earningsLaunchAt() {
  const raw = process.env.SELLER_EARNINGS_LAUNCH_AT;
  if (!raw) return null;
  const value = new Date(raw);
  if (!Number.isFinite(value.getTime())) throw new Error("Invalid SELLER_EARNINGS_LAUNCH_AT");
  return value;
}

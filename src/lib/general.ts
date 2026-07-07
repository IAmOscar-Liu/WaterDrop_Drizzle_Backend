import { Response } from "express";
import { ServiceResponse } from "../type/general";
import crypto from "crypto";
import fs from "fs";
import path from "path";

export function sendJsonResponse<T>(res: Response, result: ServiceResponse<T>) {
  res.status(result.statusCode ?? 200).json(result);
}

export function getRandomInteger(min: number = 0, max: number = 100) {
  min = Math.ceil(min); // Ensure min is an integer
  max = Math.floor(max); // Ensure max is an integer
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Generates a random string of a specified length.
 * @param {number} length The desired length of the random string.
 * @returns {string} The generated random string.
 */
export function generateRandomString(length: number) {
  // We generate half the required length in bytes because each byte converts to two hex characters.
  // Math.ceil() ensures we have enough bytes even for an odd length.
  return crypto
    .randomBytes(Math.ceil(length / 2))
    .toString("hex") // Convert the random bytes to a hexadecimal string.
    .slice(0, length); // Trim the string to the exact desired length.
}

/**
 * Generates an alphanumeric invitation code.
 * The code can contain uppercase letters, lowercase letters, and numbers.
 *
 * @param length The length of the invitation code. Defaults to 6.
 * @returns {string} An alphanumeric string of the specified length.
 */
export function generateInvitationCode(length: number = 6): string {
  // const characters =
  //   "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const characters = "ABCDEFGHJKLMNPQRSTWXYZ23456789";
  let result = "";
  const charactersLength = characters.length;

  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * charactersLength);
    result += characters.charAt(randomIndex);
  }

  return result;
}

export function getCurrentYYYYMM(timezone: string) {
  const { localYear, localMonth } = getCurrentLocalDateTime(timezone);
  return `${localYear}-${localMonth.toString().padStart(2, "0")}`;
}

export function getLastMonthYYYYMM(timezone: string) {
  const { localYear, localMonth } = getCurrentLocalDateTime(timezone);

  const year = localMonth === 1 ? localYear - 1 : localYear;
  const month = localMonth === 1 ? 12 : localMonth - 1;
  return `${year}-${month.toString().padStart(2, "0")}`;
}

export function getNumOfDaysInMonth(month: number) {
  switch (month) {
    case 1:
    case 3:
    case 5:
    case 7:
    case 8:
    case 10:
    case 12:
      return 31;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    case 2:
      return 28;
    default:
      return 0;
  }
}

export function getCurrentLocalDateTime(timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US-u-ca-gregory", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hour12: false, // Use 24-hour format
  });
  const parts = formatter.formatToParts(new Date());
  const localYear = parseInt(
    parts.find((p) => p.type === "year")?.value ?? "0",
    10,
  );
  const localMonth = parseInt(
    parts.find((p) => p.type === "month")?.value ?? "0",
    10,
  );
  const localDay = parseInt(
    parts.find((p) => p.type === "day")?.value ?? "0",
    10,
  );
  const localHour = parseInt(
    parts.find((p) => p.type === "hour")?.value ?? "0",
    10,
  );
  const localMinute = parseInt(
    parts.find((p) => p.type === "minute")?.value ?? "0",
    10,
  );
  const localSecond = parseInt(
    parts.find((p) => p.type === "second")?.value ?? "0",
    10,
  );
  return {
    localYear,
    localMonth,
    localDay,
    localHour,
    localMinute,
    localSecond,
  };
}

export function isPlainObject(value: any) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

let bankNameByCode: ReadonlyMap<string, string> | null = null;

export function getBankNameByCodeMap() {
  if (bankNameByCode) return bankNameByCode;

  const bankList = JSON.parse(
    fs.readFileSync(
      path.resolve(process.cwd(), "src/assets/json/bankList.json"),
      "utf8",
    ),
  ) as { banks: { code: string; name: string }[] };

  bankNameByCode = new Map(
    bankList.banks.map((bank) => [bank.code, bank.name]),
  );
  return bankNameByCode;
}

export function getBankNameFromCode(bankCode: string) {
  const code = bankCode.trim().padStart(3, "0");
  const bankNameByCode = getBankNameByCodeMap();
  return bankNameByCode.get(code) ?? null;
}

export function formatInteger(value: number | null) {
  return Math.floor(value ?? 0).toLocaleString("en-US");
}

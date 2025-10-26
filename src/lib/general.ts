import { Response } from "express";
import { ServiceResponse } from "../type/general";
import crypto from "crypto";

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

export function getCurrentYearMonthString(timeZone?: string, date?: Date) {
  const nowInUserTimezone = new Date(
    (date ?? new Date()).toLocaleString("en-US", {
      timeZone: timeZone ?? "UTC",
    })
  );

  const year = nowInUserTimezone.getFullYear();
  const month = (nowInUserTimezone.getMonth() + 1).toString().padStart(2, "0");
  return `${year}-${month}`;
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
    10
  );
  const localMonth = parseInt(
    parts.find((p) => p.type === "month")?.value ?? "0",
    10
  );
  const localDay = parseInt(
    parts.find((p) => p.type === "day")?.value ?? "0",
    10
  );
  const localHour = parseInt(
    parts.find((p) => p.type === "hour")?.value ?? "0",
    10
  );
  const localMinute = parseInt(
    parts.find((p) => p.type === "minute")?.value ?? "0",
    10
  );
  const localSecond = parseInt(
    parts.find((p) => p.type === "second")?.value ?? "0",
    10
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

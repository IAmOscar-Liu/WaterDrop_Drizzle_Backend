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

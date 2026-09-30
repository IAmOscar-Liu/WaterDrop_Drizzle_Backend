import jwt, { type SignOptions } from "jsonwebtoken";
import { CookieOptions, Response } from "express";

// --- Configuration ---
// In a real application, store this securely (e.g., in .env files, not in code)
const JWT_SECRET =
  process.env.JWT_SECRET ??
  "your-super-secret-and-long-string-that-is-hard-to-guess";
const DEFAULT_EXPIRATION: SignOptions["expiresIn"] = "30d";
const REFRESH_TOKEN_EXPIRATION: SignOptions["expiresIn"] = "30d";
const REFRESH_TOKEN_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;

/**
 * Generates a JSON Web Token (JWT).
 *
 * @param {object} payload - The data to include in the token (e.g., { userId: 123, role: 'user' }).
 * @param {string} [expiresIn=DEFAULT_EXPIRATION] - The token's lifetime (e.g., '7d', '24h', '60s').
 * @returns {string} The generated JWT string.
 * @throws {Error} If the payload is not a plain object.
 */
export function generateToken(
  payload: any,
  expiresIn: SignOptions["expiresIn"] = DEFAULT_EXPIRATION,
) {
  // Basic validation to ensure the payload is a suitable object
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    throw new Error("Payload must be a non-null object.");
  }

  try {
    // The sign method creates the token string
    const token = jwt.sign(
      {
        data: payload,
      },
      JWT_SECRET,
      { expiresIn },
    );
    return token;
  } catch (error) {
    console.error("Error generating JWT:", error);
    // Depending on your application's needs, you might want to re-throw
    // or handle this more gracefully.
    return undefined;
  }
}

export function generateAdminAccessToken(payload: any) {
  const expiresIn: SignOptions["expiresIn"] =
    process.env.NODE_ENV === "local" ? "1d" : "1h";
  return generateToken(payload, expiresIn);
}

/**
 * Validates a JSON Web Token (JWT) and decodes its payload.
 *
 * @param {string} token - The JWT string to validate.
 * @returns {object|null} The decoded payload if the token is valid, otherwise null.
 */
export function validateToken(token?: string) {
  if (!token) {
    return null;
  }

  try {
    // The verify method checks the signature and expiration.
    // If it's invalid, it throws an error.
    const decodedPayload = jwt.verify(token, JWT_SECRET);
    return decodedPayload;
  } catch (error: any) {
    // Common errors include 'TokenExpiredError' and 'JsonWebTokenError' (for bad signature)
    console.error("Invalid token:", error.message);
    return null;
  }
}

export function sendRefreshToken(res: Response, payload: any) {
  const refreshToken = generateToken(payload, REFRESH_TOKEN_EXPIRATION);

  res.cookie(process.env.REFRESH_TOKEN_NAME!, refreshToken, {
    ...getRefreshTokenCookieOptions(),
    maxAge: REFRESH_TOKEN_MAX_AGE_MS,
  });
}

export function clearRefreshToken(res: Response) {
  res.clearCookie(
    process.env.REFRESH_TOKEN_NAME!,
    getRefreshTokenCookieOptions(),
  );
}

function getRefreshTokenCookieOptions(): CookieOptions {
  // Determine domain based on environment
  // If production, share cookie across subdomains. If dev, leave undefined (defaults to current host)
  const domain =
    process.env.NODE_ENV === "production" ? "waterdropping.com" : undefined;

  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    domain,
    sameSite: "strict",
    path: "/",
  };
}

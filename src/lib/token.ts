import jwt, { type SignOptions } from "jsonwebtoken";
import { CookieOptions, Response } from "express";
import { CustomError } from "./error";

// --- Configuration ---
// In a real application, store this securely (e.g., in .env files, not in code)
const JWT_SECRET =
  process.env.JWT_SECRET ??
  "your-super-secret-and-long-string-that-is-hard-to-guess";
const DEFAULT_EXPIRATION: SignOptions["expiresIn"] = "30d";
export const ADMIN_TOKEN_ISSUER = "waterdrop";
export const ADMIN_TOKEN_AUDIENCE = "waterdrop-admin";

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

export function generateAdminAccessToken(
  account: { id: string; credentialVersion: number },
  sessionId: string,
  sessionExpiresAt: Date,
) {
  if (!process.env.JWT_SECRET) throw new CustomError("Admin token signing is not configured", 503);
  const lifetime = process.env.NODE_ENV === "local" ? 86400 : 3600;
  const exp = Math.min(Math.floor(Date.now() / 1000) + lifetime, Math.floor(sessionExpiresAt.getTime() / 1000));
  return jwt.sign({ data: { id: account.id, credentialVersion: account.credentialVersion },
    tokenUse: "admin_access", sid: sessionId, exp }, process.env.JWT_SECRET,
    { algorithm: "HS256", issuer: ADMIN_TOKEN_ISSUER, audience: ADMIN_TOKEN_AUDIENCE });
}

export function isAdminAccessPayload(payload: jwt.JwtPayload) {
  return payload.tokenUse === "admin_access" && payload.iss === ADMIN_TOKEN_ISSUER &&
    payload.aud === ADMIN_TOKEN_AUDIENCE && typeof payload.sid === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.sid) &&
    typeof payload.data?.id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.data.id) &&
    Number.isInteger(payload.data?.credentialVersion) && payload.data.credentialVersion >= 0 && typeof payload.exp === "number";
}

export function validateAdminAccessToken(token?: string) {
  if (!token || !process.env.JWT_SECRET) return null;
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ["HS256"], issuer: ADMIN_TOKEN_ISSUER, audience: ADMIN_TOKEN_AUDIENCE,
    });
    return typeof payload !== "string" && isAdminAccessPayload(payload) ? payload : null;
  } catch { return null; }
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

export function sendRefreshToken(res: Response, refreshToken: string, expiresAt: Date) {
  res.cookie(process.env.REFRESH_TOKEN_NAME!, refreshToken, {
    ...getRefreshTokenCookieOptions(),
    maxAge: Math.max(0, expiresAt.getTime() - Date.now()),
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

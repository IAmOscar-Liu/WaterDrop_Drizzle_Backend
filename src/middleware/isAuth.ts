import { NextFunction, Response } from "express";
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import { CustomError } from "../lib/error";
import db from "../lib/initDB";
import { isAdminAccessPayload } from "../lib/token";
import { assertAccountSession } from "../repository/accountSession";
import { requireCompletedSeller } from "../lib/accountProfile";
import { RequestWithId } from "../type/request";

const JWT_SECRET =
  process.env.JWT_SECRET ??
  "your-super-secret-and-long-string-that-is-hard-to-guess";

/**
 * Express.js middleware to validate a JWT from the Authorization header.
 *
 * It checks for a 'Bearer <token>' in the 'authorization' header.
 * If the token is valid, it attaches the decoded payload to `req.user` and calls `next()`.
 * If the token is missing or invalid, it sends a 401 or 403 response.
 *
 * @param {object} req - The Express request object.
 * @param {object} res - The Express response object.
 * @param {function} next - The Express next middleware function.
 */
async function authenticate(
  req: RequestWithId,
  _: Response,
  next: NextFunction,
  allowIncomplete = false,
) {
  const authHeader = req.headers["authorization"];
  // Extract token from "Bearer <token>" format
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) return next(new CustomError("Unauthorized", 401));

  let decodedPayload: jwt.JwtPayload | string;
  try {
    decodedPayload = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] });
  } catch (error: any) {
    console.error("Token validation error:", error.message);
    return next(new CustomError(`Token validation error -  ${error.message}`, 401));
  }

  if (typeof decodedPayload === "string") {
    return next(new CustomError("Token is invalid", 401));
  }
  if (decodedPayload.data?.id) req.userId = decodedPayload.data.id;
  if (!req.userId) return next(new CustomError("Token is invalid", 401));
  req.tokenExpiresAt = decodedPayload.exp;

  try {
    // App users and admin-side accounts share this middleware and token shape.
    // Resolve account tokens on shared routes too: a different URL must not bypass onboarding.
    const account = await db.query.accountTable.findFirst({
      where: eq(schema.accountTable.id, req.userId),
      with: { group: { with: { parent: true } } },
    });
    if (account || decodedPayload.tokenUse === "admin_access" || req.originalUrl.startsWith("/api/admin/")) {
      if (!process.env.JWT_SECRET) throw new CustomError("Admin token verification is not configured", 503);
      if (!account || account.status !== "active" || account.deletedAt) throw new CustomError("Account is inactive or no longer available", 403);
      if (!isAdminAccessPayload(decodedPayload)) throw new CustomError("Admin access token required; please log in again", 401, "ADMIN_ACCESS_TOKEN_REQUIRED");
      const version = decodedPayload.data?.credentialVersion ?? 0;
      if (!Number.isInteger(version) || version !== account.credentialVersion) throw new CustomError("Credentials changed; please log in again", 401, "ACCOUNT_CREDENTIALS_CHANGED");
      await assertAccountSession(account.id, decodedPayload.sid, version);
      req.sessionId = decodedPayload.sid;
      req.credentialVersion = version;
      if (!allowIncomplete) {
        requireCompletedSeller(account);
        if (account.group?.parent) requireCompletedSeller(account.group.parent);
      }
    }

    next();
  } catch (error) {
    next(error);
  }
}

export default function isAuth(req: RequestWithId, res: Response, next: NextFunction) {
  return authenticate(req, res, next);
}
export function isAccountAuthenticated(req: RequestWithId, res: Response, next: NextFunction) {
  return authenticate(req, res, next, true);
}

import { NextFunction, Response } from "express";
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import { CustomError } from "../lib/error";
import db from "../lib/initDB";
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
export default async function isAuth(
  req: RequestWithId,
  _: Response,
  next: NextFunction
) {
  const authHeader = req.headers["authorization"];
  // Extract token from "Bearer <token>" format
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) return next(new CustomError("Unauthorized", 401));

  let decodedPayload: jwt.JwtPayload | string;
  try {
    decodedPayload = jwt.verify(token, JWT_SECRET);
  } catch (error: any) {
    console.error("Token validation error:", error.message);
    return next(new CustomError(`Token validation error -  ${error.message}`, 401));
  }

  if (typeof decodedPayload === "string") {
    return next(new CustomError("Token is invalid", 401));
  }
  if (decodedPayload.data?.id) req.userId = decodedPayload.data.id;
  if (!req.userId) return next(new CustomError("Token is invalid", 401));

  try {
    // App users and admin-side accounts share this middleware and token shape.
    // Only admin routes must be checked against the accounts table here.
    if (req.originalUrl.startsWith("/api/admin/")) {
      const [account] = await db
        .select({
          status: schema.accountTable.status,
          deletedAt: schema.accountTable.deletedAt,
        })
        .from(schema.accountTable)
        .where(eq(schema.accountTable.id, req.userId))
        .limit(1);
      if (!account || account.status !== "active" || account.deletedAt) {
        return next(
          new CustomError("Account is inactive or no longer available", 403),
        );
      }
    }

    next();
  } catch (error) {
    next(error);
  }
}

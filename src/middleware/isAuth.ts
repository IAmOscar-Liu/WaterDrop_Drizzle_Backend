import { NextFunction, Response } from "express";
import jwt from "jsonwebtoken";
import { CustomError } from "../lib/error";
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
export default function isAuth(
  req: RequestWithId,
  _: Response,
  next: NextFunction
) {
  const authHeader = req.headers["authorization"];
  // Extract token from "Bearer <token>" format
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) return next(new CustomError("Unauthorized", 401));

  try {
    // Use jwt.verify directly to handle errors within the middleware
    const decodedPayload = jwt.verify(token, JWT_SECRET);
    if (typeof decodedPayload === "string")
      return next(new CustomError("Token is invalid", 401));

    if (decodedPayload.data?.id) req.userId = decodedPayload.data.id;

    // Attach the decoded user information to the request object
    // req.user = decodedPayload;
    // Proceed to the next middleware or route handler
    next();
  } catch (error: any) {
    // If token is not valid (e.g., expired, wrong signature)
    console.error("Token validation error:", error.message);
    next(new CustomError(`Token validation error -  ${error.message}`, 401));
  }
}

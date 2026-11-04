import { NextFunction, Request, Response } from "express";
import { usesApiErrorContract } from "../lib/requestContext";
import { CustomError, ZodValidationError, handleServiceError } from "../lib/error";

export const errorHandler = (err: Error, _: Request, res: Response, __: NextFunction) => {
  if (!usesApiErrorContract()) {
    const statusCode = err instanceof CustomError || err instanceof ZodValidationError ? err.statusCode : 500;
    const message = err instanceof ZodValidationError ? err.validationErrors : err.message;
    res.status(statusCode).json({ success: false, statusCode, message,
      ...(err instanceof CustomError && err.code ? { code: err.code } : {}) });
    return;
  }
  const failure = handleServiceError(err);
  res.locals.failureCode = failure.code;
  if (res.headersSent) {
    if (!res.destroyed && String(res.getHeader("Content-Type")).includes("text/event-stream") && res.writableLength < 1024 * 1024) {
      res.end(`event: stream.reset\ndata: ${JSON.stringify({ reason: failure.statusCode === 401 ? "auth_expired" : "resync_required" })}\n\n`);
    } else res.destroy();
    return;
  }
  res.status(failure.statusCode ?? 500).json(failure);
};

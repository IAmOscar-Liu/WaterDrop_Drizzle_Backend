import { NextFunction, Request, Response } from "express";
import { CustomError, RequestValidationError } from "../lib/error";

export const errorHandler = (
  err: Error,
  _: Request,
  res: Response,
  __: NextFunction
) => {
  let statusCode = 500;
  let message: any;

  if (err instanceof CustomError) {
    statusCode = err.statusCode;
    message = err.message;
  } else if (err instanceof RequestValidationError) {
    statusCode = err.statusCode;
    message = err.validationErrors;
  } else {
    message = err.message;
  }

  res.status(statusCode).json({
    success: false,
    statusCode,
    message,
  });
};

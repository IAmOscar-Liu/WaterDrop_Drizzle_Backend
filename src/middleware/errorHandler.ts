import { NextFunction, Request, Response } from "express";
import { CustomError } from "../lib/error";

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
  } else {
    message = err.message;
  }

  res.status(statusCode).json({
    success: false,
    statusCode,
    message,
  });
};

import { NextFunction, Response } from "express";
import { CustomError } from "../lib/error";
import { isAccountAdmin } from "../repository/account";
import { RequestWithId } from "../type/request";

export default async function isAdmin(
  req: RequestWithId,
  _: Response,
  next: NextFunction,
) {
  try {
    if (!req.userId || !(await isAccountAdmin(req.userId))) {
      return next(new CustomError("Administrator access required.", 403));
    }

    next();
  } catch (error) {
    next(error);
  }
}

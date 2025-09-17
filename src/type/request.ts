import { Request } from "express";

export type RequestWithId = Request & {
  userId?: string;
};

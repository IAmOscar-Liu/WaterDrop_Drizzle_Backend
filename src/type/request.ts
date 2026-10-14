import { Request } from "express";

export type RequestWithId = Request & {
  userId?: string;
  tokenExpiresAt?: number;
  credentialVersion?: number;
  sessionId?: string;
};

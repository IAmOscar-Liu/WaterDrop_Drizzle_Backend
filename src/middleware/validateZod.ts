import { NextFunction, Request, Response } from "express";
import { z, ZodTypeAny } from "zod";
import { ZodValidationError } from "../lib/error";

type RequestSchemas = {
  body?: ZodTypeAny;
  params?: ZodTypeAny;
  query?: ZodTypeAny;
};

function formatZodError(error: z.ZodError) {
  return error.issues.map((issue) => ({
    field: issue.path.join("."),
    message: issue.message,
  }));
}

function setRequestValue<T extends keyof Request>(
  req: Request,
  key: T,
  value: Request[T],
) {
  Object.defineProperty(req, key, {
    value,
    writable: true,
    configurable: true,
    enumerable: true,
  });
}

export default function validateZod(schemas: RequestSchemas) {
  return (req: Request, res: Response, next: NextFunction) => {
    const errors: ReturnType<typeof formatZodError> = [];

    if (schemas.params) {
      const result = schemas.params.safeParse(req.params);
      if (result.success) {
        setRequestValue(req, "params", result.data as Request["params"]);
      } else {
        errors.push(...formatZodError(result.error));
      }
    }

    if (schemas.query) {
      const result = schemas.query.safeParse(req.query);
      if (result.success) {
        setRequestValue(req, "query", result.data as Request["query"]);
      } else {
        errors.push(...formatZodError(result.error));
      }
    }

    if (schemas.body) {
      const result = schemas.body.safeParse(req.body);
      if (result.success) {
        setRequestValue(req, "body", result.data);
      } else {
        errors.push(...formatZodError(result.error));
      }
    }

    if (errors.length > 0) {
      return next(new ZodValidationError(errors));
    }

    next();
  };
}

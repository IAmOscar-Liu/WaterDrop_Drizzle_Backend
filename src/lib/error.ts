import { serializeFailure } from "./errorPolicy";
import { recordErrorCause, usesApiErrorContract } from "./requestContext";
import { ServiceResponseFailure } from "../type/general";

export type ZodValidationIssue = {
  field: string;
  code?: string;
  message: string;
};

export class CustomError extends Error {
  public statusCode: number;

  constructor(message: string, statusCode: number, public code?: string) {
    super(message);
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this);
  }
}

export class ZodValidationError extends Error {
  public statusCode: number;
  public validationErrors: ZodValidationIssue[];

  constructor(validationErrors: ZodValidationIssue[], statusCode = 400) {
    super("Validation failed");
    this.validationErrors = validationErrors;
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this);
  }
}

export function handleServiceError(error: unknown): ServiceResponseFailure {
  if (!usesApiErrorContract()) {
    if (error instanceof CustomError) return { success: false, statusCode: error.statusCode,
      message: error.message, ...(error.code ? { code: error.code } : {}) };
    return { success: false, statusCode: 500,
      message: error && typeof error === "object" && "message" in error ? error.message || "Unknown error" : "Unknown error" };
  }
  recordErrorCause(error);
  if (error instanceof ZodValidationError) {
    return serializeFailure({ statusCode: error.statusCode, code: "VALIDATION_FAILED", message: error.validationErrors,
      fieldErrors: error.validationErrors.map(issue => ({ field: issue.field, code: issue.code ?? "INVALID_VALUE", message: issue.message })) });
  }
  if (error instanceof CustomError) {
    return serializeFailure({ statusCode: error.statusCode, message: error.message, code: error.code });
  }
  // Known HTTP parser/file errors retain their status without exposing their text.
  const native = error && typeof error === "object"
    ? error as { type?: string; expose?: boolean; status?: number; statusCode?: number } : {};
  const parserTypes = ["entity.parse.failed", "entity.too.large", "request.aborted", "request.size.invalid", "encoding.unsupported", "charset.unsupported"];
  const nativeStatus = parserTypes.includes(native.type ?? "") || native.expose === true ? native.status ?? native.statusCode : undefined;
  return serializeFailure({ statusCode: nativeStatus ?? 500 });
}

import { ServiceResponseFailure } from "../type/general";

export type ZodValidationIssue = {
  field: string;
  message: string;
};

export class CustomError extends Error {
  public statusCode: number;

  constructor(message: string, statusCode: number) {
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

export function handleServiceError(error: any): ServiceResponseFailure {
  if (error instanceof CustomError) {
    return {
      success: false,
      statusCode: error.statusCode,
      message: error.message,
    };
  } else {
    return {
      success: false,
      statusCode: 500,
      message: error?.message || "Unknown error",
    };
  }
}

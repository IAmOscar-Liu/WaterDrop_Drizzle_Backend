import type { ServiceResponseFailure } from "../type/general";

export type FieldError = { field: string; code: string; message: string };

const common: Record<number, { code: string; message: string }> = {
  400: { code: "VALIDATION_FAILED", message: "Please check the request fields" },
  401: { code: "UNAUTHENTICATED", message: "Please sign in again" },
  403: { code: "FORBIDDEN", message: "This action is not available" },
  404: { code: "RESOURCE_NOT_FOUND", message: "The requested resource is unavailable" },
  409: { code: "CONFLICT", message: "The request conflicts with the current state" },
  413: { code: "PAYLOAD_TOO_LARGE", message: "The request is too large" },
  429: { code: "RATE_LIMITED", message: "Too many requests; please try again later" },
  500: { code: "INTERNAL_ERROR", message: "Something went wrong; please try again later" },
  502: { code: "SERVICE_UNAVAILABLE", message: "Service temporarily unavailable" },
  503: { code: "SERVICE_UNAVAILABLE", message: "Service temporarily unavailable" },
  504: { code: "SERVICE_UNAVAILABLE", message: "Service temporarily unavailable" },
};

const publicMessages: Record<string, string> = {
  REFUNDS_DISABLED: "REFUNDS_DISABLED",
  ORDER_NOT_PAID: "ORDER_NOT_PAID",
  NOT_RECEIVED: "NOT_RECEIVED",
  RECEIPT_TIME_UNKNOWN: "RECEIPT_TIME_UNKNOWN",
  PAYMENT_TIME_UNKNOWN: "PAYMENT_TIME_UNKNOWN",
  REFUND_WINDOW_EXPIRED: "REFUND_WINDOW_EXPIRED",
  NO_REFUNDABLE_QUANTITY: "NO_REFUNDABLE_QUANTITY",
  INSUFFICIENT_SPENDABLE_COINS: "There are not enough non-expired coins for this payment",
  PAYMENT_CONFIRMATION_PENDING: "Payment is being confirmed; refresh the original order",
  PAYMENT_ALREADY_STARTED: "Payment has already started; refresh the original order",
  PAYMENT_REVIEW_REQUIRED: "Payment is being reconciled; please check the original order or contact support",
  REFUND_REQUEST_CONFLICT: "This refund request key was already used with a different request",
  REFUND_AGREEMENT_REQUIRED: "Buyer agreement is required before changing the refund",
  REFUND_TERMINAL: "This refund is already finalized",
};

const fieldMessages: Record<string, string> = {
  INVALID_TYPE: "Please enter a value of the correct type",
  VALUE_TOO_SMALL: "The value is below the allowed minimum",
  VALUE_TOO_LARGE: "The value exceeds the allowed maximum",
  INVALID_FORMAT: "Please enter a value in the correct format",
  INVALID_VALUE: "Please check this value",
  UNRECOGNIZED_FIELDS: "The request contains unsupported fields",
  INVALID_MULTIPLE: "The value does not match the allowed increment",
  PRODUCT_UNAVAILABLE: "This product is unavailable",
  VARIANT_UNAVAILABLE: "This product variant is unavailable",
  INSUFFICIENT_STOCK: "There is not enough stock",
  INVALID_REFUND_QUANTITY: "Please check the refund quantity",

};

export function validationIssueCode(code?: string): string {
  return ({ invalid_type: "INVALID_TYPE", too_small: "VALUE_TOO_SMALL", too_big: "VALUE_TOO_LARGE",
    invalid_format: "INVALID_FORMAT", invalid_value: "INVALID_VALUE", unrecognized_keys: "UNRECOGNIZED_FIELDS",
    not_multiple_of: "INVALID_MULTIPLE" } as Record<string, string>)[code ?? ""] ?? "INVALID_VALUE";
}

export function defaultError(status: number) {
  return common[status] ?? (status >= 500 ? common[500] : common[400]);
}

function validStatus(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 400 && value <= 599;
}

function code(value: unknown, fallback: string): string {
  return typeof value === "string" && /^[A-Z][A-Z0-9_]{1,95}$/.test(value) ? value : fallback;
}

function safeField(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_.\[\]-]{0,120}$/.test(value)) return "";
  // System notification data is a free-form record; its keys are submitted values.
  if (value.startsWith("data.")) return "data";
  if (/(?:^|\.)(?:eyJ[A-Za-z0-9_-]+|SG)(?:\.|$)/.test(value)) return "";
  return value;
}

function fieldError(value: unknown): FieldError {
  const entry = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const issueCode = typeof entry.code === "string" && Object.prototype.hasOwnProperty.call(fieldMessages, entry.code) ? entry.code : "INVALID_VALUE";
  return { field: safeField(entry.field), code: issueCode, message: fieldMessages[issueCode] };
}

// Preserve legacy checkout JSON-string error lists, while allowing only known-safe fields.
function legacyList(message: unknown): Record<string, unknown>[] | undefined {
  try {
    const parsed = typeof message === "string" ? JSON.parse(message) : message;
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.error)) return parsed.error;
  } catch { /* An ordinary message is not a legacy list. */ }
}

export function serializeFailure(input: Partial<ServiceResponseFailure>, httpStatus?: number, requestId?: string): ServiceResponseFailure {
  const statusCode = validStatus(input.statusCode) ? input.statusCode : validStatus(httpStatus) ? httpStatus : 500;
  const fallback = defaultError(statusCode);
  const errorCode = code(input.code, fallback.code);
  const diagnosticEnvironment = ["local", "development", "test"].includes(process.env.NODE_ENV ?? "");
  const entries = legacyList(input.message) ?? (Array.isArray(input.error) ? input.error : undefined);
  let message: unknown = publicMessages[errorCode] ?? fallback.message;
  let fieldErrors: FieldError[] | undefined;
  if (Array.isArray(input.message)) {
    fieldErrors = input.message.map(fieldError);
    message = input.message.map((entry, index) => ({ field: fieldErrors![index].field,
      message: diagnosticEnvironment && typeof entry?.message === "string" ? entry.message : fieldErrors![index].message }));
  } else if (entries) {
    const safe = entries.map(entry => {
      const reasonCode = ({ "Product not found": "PRODUCT_UNAVAILABLE", "Product deleted": "PRODUCT_UNAVAILABLE",
        "Product inactive": "PRODUCT_UNAVAILABLE", "Variant not found": "VARIANT_UNAVAILABLE",
        "Variant inactive": "VARIANT_UNAVAILABLE", "Insufficient stock": "INSUFFICIENT_STOCK" } as Record<string, string>)[String(entry?.reason)] ?? "INVALID_VALUE";
      const result: Record<string, unknown> = { reason: fieldMessages[reasonCode], code: reasonCode };
      for (const [key, value] of Object.entries(entry && typeof entry === "object" ? entry : {})) {
        if (["productId", "productVariantId", "orderItemId"].includes(key) && typeof value === "string"
          && /^[0-9a-f-]{36}$/i.test(value)) result[key] = value;
        if (["quantity", "remaining", "refundedQuantity", "unitPriceAtSale"].includes(key) && typeof value === "number" && Number.isFinite(value)) result[key] = value;
      }
      return result;
    });
    message = diagnosticEnvironment ? input.message : typeof input.message === "string" ? JSON.stringify({ error: safe }) : { error: safe };
    fieldErrors = safe.map(entry => ({ field: "", code: String(entry.code), message: String(entry.reason) }));
  } else if (diagnosticEnvironment && statusCode < 500 && typeof input.message === "string") {
    message = input.message;
  }
  if (Array.isArray(input.fieldErrors)) fieldErrors = input.fieldErrors.map(fieldError);
  return { success: false, statusCode, code: errorCode, message,
    ...(fieldErrors?.length ? { fieldErrors } : {}),
    ...(input.error !== undefined ? { error: Array.isArray(input.error) && entries ?
      (diagnosticEnvironment ? input.error : (legacyList(message) ?? []).map(entry => entry)) : String(message) } : {}),
    ...(requestId ? { requestId } : {}) };
}

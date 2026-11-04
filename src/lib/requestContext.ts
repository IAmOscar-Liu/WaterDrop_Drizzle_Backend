import { AsyncLocalStorage } from "node:async_hooks";

export type RequestContext = { requestId: string; apiErrors: boolean; cause?: { name: string; code?: string; source?: string[] } };
export const requestContext = new AsyncLocalStorage<RequestContext>();

// Match all API routes, including admin, before routers and body parsers run.
export function isApiRequest(req: { originalUrl?: string; url?: string }): boolean {
  const path = (req.originalUrl ?? req.url ?? "").split("?")[0].toLowerCase();
  return path === "/api" || path.startsWith("/api/");
}

export function usesApiErrorContract(): boolean {
  return requestContext.getStore()?.apiErrors === true;
}

// Log classification, never arbitrary provider/DB exception text or submitted values.
export function errorDiagnostic(error: unknown) {
  const candidate = error && typeof error === "object" ? error as { name?: string; code?: string; cause?: { code?: string }; stack?: string } : {};
  const names = ["Error", "TypeError", "SyntaxError", "CustomError", "ZodValidationError", "PostgresError", "DatabaseError", "AxiosError"];
  const rawCode = candidate.cause?.code ?? candidate.code;
  const codes = ["23505", "23503", "23514", "22P02", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "ECONNABORTED"];
  const source = (candidate.stack ?? "").split("\n").slice(1).filter(line => /^\s*at /.test(line))
    .flatMap(line => [...line.matchAll(/\/(?:src|dist)\/([A-Za-z0-9_/-]+\.[jt]s:\d+:\d+)/g)].map(match => match[1]))
    .slice(0, 5);
  return { name: candidate.name && names.includes(candidate.name) ? candidate.name : "Error",
    ...(rawCode && codes.includes(rawCode) ? { code: rawCode } : {}), ...(source.length ? { source } : {}) };
}


export function recordErrorCause(error: unknown) {
  const context = requestContext.getStore();
  if (context?.apiErrors) context.cause = errorDiagnostic(error);
}

export function logDiagnosticError(event: string, error: unknown, details?: { paymentAttemptId?: string }) {
  const context = requestContext.getStore();
  if (!context?.apiErrors) { console.error(event, error); return; }
  console.error(JSON.stringify({ event, ...(context ? { requestId: context.requestId } : {}),
    ...(details?.paymentAttemptId && /^[0-9a-f-]{36}$/i.test(details.paymentAttemptId) ? { paymentAttemptId: details.paymentAttemptId } : {}),
    cause: errorDiagnostic(error) }));
}

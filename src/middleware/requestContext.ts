import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import { defaultError, serializeFailure } from "../lib/errorPolicy";
import { isApiRequest, requestContext, type RequestContext } from "../lib/requestContext";

export const requestContextMiddleware: RequestHandler = (req, res, next) => {
  const apiErrors = isApiRequest(req);
  const context: RequestContext = { requestId: apiErrors ? randomUUID() : "", apiErrors };
  // Non-API requests retain their existing behavior.
  if (!apiErrors) return requestContext.run(context, next);
  const start = Date.now();
  res.locals.requestId = context.requestId;
  res.setHeader("X-Request-ID", context.requestId);
  // Covers shared service responses and controllers using res.json directly.
  const json = res.json.bind(res);
  res.json = ((body: unknown) => {
    if (body && typeof body === "object" && (body as { success?: unknown }).success === false) {
      const failure = serializeFailure(body, res.statusCode, context.requestId);
      res.status(failure.statusCode!);
      res.locals.failureCode = failure.code;
      return json(failure);
    }
    return json(body);
  }) as typeof res.json;
  let logged = false;
  const log = () => {
    if (logged) return;
    logged = true;
    // Use matched route templates, not originalUrl (which can contain JWT/payment tokens).
    const route = typeof req.route?.path === "string" ? `${req.baseUrl}${req.route.path}` : "(unmatched)";
    const statusCode = res.statusCode;
    const failed = statusCode >= 400 || Boolean(res.locals.failureCode);
    const entry = { event: failed ? "http.failure" : "http.request", requestId: context.requestId,
      method: req.method, route, statusCode, durationMs: Date.now() - start,
      ...(failed ? { code: res.locals.failureCode ?? defaultError(statusCode).code, cause: context.cause } : {}) };
    if (statusCode >= 500) console.error(JSON.stringify(entry));
    else console.info(JSON.stringify(entry));
  };
  requestContext.run(context, () => {
    res.once("finish", log);
    res.once("close", log);
    next();
  });
};

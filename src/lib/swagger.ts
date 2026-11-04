import swaggerJsDoc from "swagger-jsdoc";
import path from "path";

const routerFileExtension = __filename.endsWith(".js") ? "js" : "ts";
const adminRouterDocsPath = path.resolve(
  __dirname,
  `../routers/admin/*.${routerFileExtension}`,
);

const options: swaggerJsDoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Water drop API",
      version: "1.0.0",
      description:
        "This is the documentation for the Water drop API, which provides endpoints for managing products, orders, advertisements, and user accounts.",
    },
    tags: [
      { name: "Account", description: "Administrator authentication and account management" },
      { name: "Account Wallet", description: "Seller wallet balances and funding transactions" },
      { name: "Dashboard", description: "Seller-scoped dashboard and activity reporting" },
      { name: "Product", description: "Product and product-variant management" },
      { name: "Advertisement", description: "Advertisement management and coin accounting" },
      { name: "Order", description: "Order management" },
      { name: "Delivery", description: "Delivery and logistics management" },
      { name: "Refund", description: "Refund management" },
      { name: "Chatroom", description: "Customer-support chat management" },
      { name: "Sidebar Notifications", description: "Per-account admin navigation badges" },
      { name: "File", description: "File uploads" },
      { name: "System", description: "System configuration and reference data" },
    ],
  },
  apis: [adminRouterDocsPath],
};

export const swaggerSpec = swaggerJsDoc(options);

// Keep the shared runtime error contract consistent across every admin operation.
const spec = swaggerSpec as { components?: Record<string, any>; paths?: Record<string, Record<string, any>> };
spec.components ??= {};
spec.components.schemas ??= {};
spec.components.headers ??= {};
spec.components.responses ??= {};
spec.components.schemas.ApiFieldError = {
  type: "object", required: ["field", "code", "message"],
  properties: {
    field: { type: "string", description: "Request schema path with dot indices; empty for form-level errors." },
    code: { type: "string", example: "INVALID_FORMAT" },
    message: { type: "string", description: "Safe field feedback; localize using the field and code." },
  },
};
spec.components.schemas.ApiFailure = {
  type: "object", required: ["success", "statusCode", "code", "message", "requestId"],
  properties: {
    success: { type: "boolean", enum: [false] },
    statusCode: { type: "integer", minimum: 400, maximum: 599, example: 400 },
    code: { type: "string", description: "Existing business code or stable HTTP fallback. Do not parse message text.", example: "VALIDATION_FAILED" },
    message: { description: "Safe message, legacy validation array or legacy item-error structure. Never assume a string.", oneOf: [
      { type: "string" }, { type: "array", items: { type: "object", properties: { field: { type: "string" }, message: { type: "string" } } } },
      { type: "object", additionalProperties: true },
    ] },
    requestId: { type: "string", format: "uuid", description: "Server-generated support reference matching X-Request-ID; not an idempotency key." },
    fieldErrors: { type: "array", items: { $ref: "#/components/schemas/ApiFieldError" } },
    error: { description: "Optional sanitized legacy error structure.", oneOf: [{ type: "string" }, { type: "array", items: { type: "object", additionalProperties: true } }] },
  },
};
spec.components.schemas.ErrorResponse = { $ref: "#/components/schemas/ApiFailure" };
spec.components.headers.RequestId = { description: "Server-generated request UUID. Caller-supplied values are ignored.", schema: { type: "string", format: "uuid" } };
spec.components.headers.RetryAfter = { description: "Optional known cooldown, as seconds or HTTP-date. Not promised for every 429/503.", schema: { type: "string" } };
const errorHeaders = {
  "X-Request-ID": { $ref: "#/components/headers/RequestId" },
  "Retry-After": { $ref: "#/components/headers/RetryAfter" },
};
spec.components.responses.ApiError = {
  description: "JSON API failure. Preserve business codes; use a status fallback for unknown codes. Public environments mask arbitrary exception messages.",
  headers: errorHeaders, content: { "application/json": { schema: { $ref: "#/components/schemas/ApiFailure" } } },
};
function documentResponse(response: Record<string, any>, failure: boolean) {
  if (response.$ref) return;
  response.headers = { ...response.headers, "X-Request-ID": errorHeaders["X-Request-ID"] };
  if (!failure) return;
  response.headers = { ...response.headers, ...errorHeaders };
  // Preserve any explicitly documented provider text/HTML protocols.
  if (response.content && !response.content["application/json"]) return;
  response.content ??= {};
  response.content["application/json"] = { schema: { $ref: "#/components/schemas/ApiFailure" } };
}
for (const [name, response] of Object.entries(spec.components.responses)) {
  documentResponse(response as Record<string, any>, /error|unauthorized|forbidden|notfound/i.test(name));
}
for (const pathItem of Object.values(spec.paths ?? {})) {
  for (const method of ["get", "post", "put", "patch", "delete", "head", "options"]) {
    const operation = pathItem[method];
    if (!operation) continue;
    operation.responses ??= {};
    operation.responses.default ??= { $ref: "#/components/responses/ApiError" };
    for (const [status, response] of Object.entries(operation.responses)) {
      documentResponse(response as Record<string, any>, status === "default" || /^[45]/.test(status));
    }
  }
}

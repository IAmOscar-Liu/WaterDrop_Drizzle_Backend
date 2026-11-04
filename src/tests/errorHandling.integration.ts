import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import express from "express";
import cors from "cors";
import { z } from "zod";
import { requestContextMiddleware } from "../middleware/requestContext";
import { errorHandler } from "../middleware/errorHandler";
import validateZod from "../middleware/validateZod";
import { CustomError, handleServiceError } from "../lib/error";
import { sendJsonResponse } from "../lib/general";
import { isApiRequest } from "../lib/requestContext";
import { swaggerSpec } from "../lib/swagger";
import { serializeFailure } from "../lib/errorPolicy";

async function run() {
  const originalEnv = process.env.NODE_ENV;
  const originalError = console.error;
  const originalInfo = console.info;
  const logs: string[] = [];
  console.error = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
  console.info = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
  const secret = "SELECT password FROM private_db; Bearer secret-token-123; oscar@example.test /Users/private/key.pem";
  const fixture = express();
  fixture.use(requestContextMiddleware);
  fixture.use((req, res, next) => cors(isApiRequest(req) ? { exposedHeaders: ["X-Request-ID", "Retry-After"] } : {})(req, res, next));
  fixture.use(express.json({ limit: "1kb" }));
  const router = express.Router();
  fixture.use("/api", router);
  router.get("/service", (_, res) => sendJsonResponse(res, handleServiceError(new Error(secret))));
  router.get("/middleware", () => { throw new Error(secret); });
  router.get("/auth", () => { throw new CustomError(secret, 401); });
  router.post("/validation", validateZod({ body: z.object({ phone: z.string().refine(() => false, secret) }) }), (_, res) => res.json({ success: true }));
  router.get("/legacy", () => { throw new CustomError(JSON.stringify({ error: [{ productName: secret,
    productId: "00000000-0000-4000-8000-000000000001", reason: "Product inactive", quantity: 2 }] }), 400); });
  router.get("/direct", (_, res) => res.status(409).json({ success: false, message: secret, code: "REFUND_REQUEST_CONFLICT", sql: secret }));
  router.get("/legacy-failure", (_, res) => res.json({ success: false, message: secret }));
  router.get("/cooldown", (_, res) => { res.setHeader("Retry-After", "15"); sendJsonResponse(res, { success: false, statusCode: 429, message: secret }); });
  router.get("/success", (_, res) => res.json({ success: true, data: { canCheckout: false, issues: [{ code: "INSUFFICIENT_STOCK" }] } }));
  router.post("/callback", (_, res) => res.status(500).type("text/plain").send("0|Payment confirmation could not be saved"));
  router.get("/html", (_, res) => res.type("html").send("<form>payment form</form>"));
  router.get("/stream", (_, res, next) => { res.type("text/event-stream"); res.write("event: ready\ndata: {}\n\n"); next(new Error(secret)); });
  router.get("/", (_, res) => res.json({ success: false, message: secret }));
  fixture.use("/api/admin", router);
  fixture.use(errorHandler);
  const server = fixture.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  async function failure(path: string, status: number, init?: RequestInit) {
    const response = await fetch(base + path, { headers: { origin: "https://stg.waterdropping.com", "X-Request-ID": "untrusted-secret" }, ...init });
    assert.equal(response.status, status, path);
    const text = await response.text();
    assert.ok(!text.includes("private_db") && !text.includes("secret-token") && !text.includes("oscar@example") && !text.includes("key.pem"), text);
    const json = JSON.parse(text);
    assert.equal(json.statusCode, status);
    assert.equal(json.success, false);
    assert.equal(json.requestId, response.headers.get("X-Request-ID"));
    assert.match(json.requestId, /^[0-9a-f-]{36}$/);
    assert.notEqual(json.requestId, "untrusted-secret");
    assert.match(response.headers.get("Access-Control-Expose-Headers")!, /X-Request-ID/i);
    return { response, json };
  }
  try {
    for (const environment of ["stg", "production", "unknown", undefined]) {
      if (environment) process.env.NODE_ENV = environment; else delete process.env.NODE_ENV;
      for (const prefix of ["", "/admin"]) {
        const service = await failure(prefix + "/service?token=secret-token-123", 500);
        assert.equal(service.json.code, "INTERNAL_ERROR");
        assert.equal((await failure(prefix + "/middleware", 500)).json.message, service.json.message);
        assert.equal((await failure(prefix + "/auth", 401)).json.code, "UNAUTHENTICATED");
        const direct = await failure(prefix + "/direct", 409);
        assert.equal(direct.json.code, "REFUND_REQUEST_CONFLICT");
        assert.ok(!("sql" in direct.json));
        const validation = await failure(prefix + "/validation", 400, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: "bad" }) });
        assert.ok(Array.isArray(validation.json.message));
        assert.equal(validation.json.fieldErrors[0].field, "phone");
        assert.equal(validation.json.fieldErrors[0].code, "INVALID_VALUE");
        const legacy = await failure(prefix + "/legacy", 400);
        assert.ok(Array.isArray(JSON.parse(legacy.json.message).error));
        assert.equal(JSON.parse(legacy.json.message).error[0].quantity, 2);
        assert.equal(legacy.json.fieldErrors[0].code, "PRODUCT_UNAVAILABLE");
      }
    }
    process.env.NODE_ENV = "production";
    assert.equal((await failure("/legacy-failure", 500)).json.code, "INTERNAL_ERROR");
    assert.equal((await failure("/cooldown", 429)).response.headers.get("Retry-After"), "15");
    const malformed = await failure("/validation", 400, { method: "POST", headers: { "content-type": "application/json" }, body: "invalid secret-token-123" });
    assert.equal(malformed.json.code, "VALIDATION_FAILED");
    const success = await fetch(base + "/success");
    assert.equal(success.status, 200);
    assert.deepEqual(await success.json(), { success: true, data: { canCheckout: false, issues: [{ code: "INSUFFICIENT_STOCK" }] } });
    assert.equal(await (await fetch(base + "/callback", { method: "POST" })).text(), "0|Payment confirmation could not be saved");
    assert.equal(await (await fetch(base + "/html")).text(), "<form>payment form</form>");
    const stream = await fetch(base + "/stream");
    const streamText = await stream.text();
    assert.ok(streamText.includes("event: stream.reset"));
    assert.ok(!streamText.includes("requestId") && !streamText.includes("private_db"));
    const rawResult = serializeFailure({ success: false, statusCode: 400, error: [{ reason: secret, quantity: 1 }] });
    const recordField = serializeFailure({ success: false, statusCode: 400,
      fieldErrors: [{ field: "data.secret-token-123", code: "INVALID_TYPE", message: secret }] });
    assert.equal(recordField.fieldErrors![0].field, "data");
    assert.ok(!JSON.stringify(recordField).includes("secret-token"));
    assert.ok(Array.isArray(rawResult.error));
    assert.ok(!JSON.stringify(rawResult).includes("private_db"));
    assert.ok(logs.some(line => line.includes('"event":"http.failure"') && line.includes('"route":"/api/service"')));
    assert.ok(logs.every(line => !line.includes("secret-token") && !line.includes("private_db") && !line.includes("oscar@example")));
    for (const path of ["/admin", "/admin/", "/ADMIN/", "/admin/legacy-failure"]) {
      assert.equal((await failure(path, 500)).json.code, "INTERNAL_ERROR");
    }
    const adminMalformed = await failure("/admin/validation", 400, { method: "POST", headers: { "content-type": "application/json" }, body: "invalid-json" });
    assert.equal(adminMalformed.json.code, "VALIDATION_FAILED");
    assert.equal((await failure("/admin/cooldown", 429)).response.headers.get("Retry-After"), "15");
    const adminSuccess = await fetch(base + "/admin/success");
    assert.deepEqual(await adminSuccess.json(), { success: true, data: { canCheckout: false, issues: [{ code: "INSUFFICIENT_STOCK" }] } });
    assert.equal(await (await fetch(base + "/admin/html")).text(), "<form>payment form</form>");
    const adminStream = await (await fetch(base + "/admin/stream")).text();
    assert.ok(adminStream.includes("event: stream.reset") && !adminStream.includes("private_db"));
    assert.ok(logs.some(line => line.includes('"event":"http.failure"') && line.includes('"route":"/api/admin/service"')));
    assert.ok(logs.every(line => !line.includes("secret-token") && !line.includes("private_db") && !line.includes("oscar@example")));
    assert.equal(handleServiceError(new Error(secret)).message, secret, "non-HTTP shared services retain legacy behavior");
    assert.equal(isApiRequest({ originalUrl: "/API/ADMIN?x=1" }), true);
    assert.equal(isApiRequest({ originalUrl: "/api-docs" }), false);
    const spec = swaggerSpec as any;
    assert.equal(spec.components.schemas.ErrorResponse.$ref, "#/components/schemas/ApiFailure");
    assert.ok(spec.components.schemas.ApiFailure.required.includes("requestId"));
    for (const operation of Object.values(spec.paths).flatMap((path: any) => Object.values(path)) as any[]) {
      if (!operation.responses) continue;
      assert.equal(operation.responses.default.$ref, "#/components/responses/ApiError");
    }
    const printResponses = spec.paths["/api/admin/delivery/helper/printTradeDocument"].get.responses;
    assert.ok(printResponses["200"].content["text/html"]);
    assert.equal(printResponses["401"].content["application/json"].schema.$ref, "#/components/schemas/ApiFailure");
    process.env.NODE_ENV = "test";
    const local = serializeFailure({ success: false, statusCode: 400, message: [{ field: "endDate", message: "endDate must be later than startDate." }] });
    assert.deepEqual(local.message, [{ field: "endDate", message: "endDate must be later than startDate." }]);
  } finally {
    if (originalEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalEnv;
    console.error = originalError;
    console.info = originalInfo;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  console.log("Error contract passed: public masking, legacy fields, codes, request references/logs, CORS, parser errors, cooldown, success, payment and SSE protocols; admin/app policy parity, admin Swagger and no-context service behavior.");
}
run().catch(error => { console.error(error); process.exitCode = 1; });

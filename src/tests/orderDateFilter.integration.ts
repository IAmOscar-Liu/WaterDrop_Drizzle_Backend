import "../lib/env";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { eq, sql } from "drizzle-orm";
import app from "../app";
import * as schema from "../db/schema";
import db, { client } from "../lib/initDB";
import { generateToken } from "../lib/token";
import { swaggerSpec } from "../lib/swagger";

async function run() {
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.NO_CRON, "true");
  assert.equal(process.env.TEST_DATABASE_MANAGED, "true");
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    const [user, otherUser] = await db.insert(schema.userTable).values(
      ["owner", "other"].map((label) => ({
        email: `order-date-${label}-${randomUUID()}@example.test`,
        oauthProvider: "other" as const,
        oauthId: randomUUID(),
        referralCode: randomUUID(),
      })),
    ).returning();
    const token = generateToken({ id: user.id });
    assert.ok(token);
    const startDate = "2026-09-28T16:00:00.000Z";
    const endDate = "2026-09-29T16:00:00.000Z";
    const fixture = (
      createdAt: string,
      completedAt: string | null,
      extra: Partial<schema.NewOrder> = {},
    ): schema.NewOrder => ({
      id: randomUUID(), userId: user.id, subTotal: 10, totalAmount: 10,
      orderStatus: "paid", createdAt: new Date(createdAt),
      completedAt: completedAt ? new Date(completedAt) : null, ...extra,
    });
    const atStart = fixture("2026-09-28T15:55:00Z", startDate);
    const fallback = fixture("2026-09-28T17:00:00Z", null, { orderStatus: "payment-processing" });
    const tied = fixture("2026-09-28T15:00:00Z", "2026-09-28T17:00:00Z");
    const justBeforeEnd = fixture("2026-09-29T14:00:00Z", "2026-09-29T15:59:59.999Z");
    const atEnd = fixture("2026-09-28T18:00:00Z", endDate);
    const beforeStart = fixture("2026-09-28T13:00:00Z", "2026-09-28T15:59:59.999Z");
    const ineligible = (["pending", "failed", "expired", "canceled"] as const)
      .map((orderStatus) => fixture("2026-09-28T19:00:00Z", null, { orderStatus }));
    const foreign = fixture(startDate, null, { userId: otherUser.id });
    await db.insert(schema.orderTable).values([
      atStart, fallback, tied, justBeforeEnd, atEnd, beforeStart, ...ineligible, foreign,
    ]);

    // Multiple child records must not duplicate orders or inflate the total.
    const [seller] = await db.insert(schema.accountTable).values({
      email: `order-date-seller-${randomUUID()}@example.test`, password: "unused",
      realName: "Order date fixture", phone: "0900000000", role: "seller",
    }).returning();
    const [product] = await db.insert(schema.productTable).values({
      sellerId: seller.id, name: "Date filter fixture", description: "Test only",
    }).returning();
    const variants = await db.insert(schema.productVariantTable).values([
      { productId: product.id, price: 5, stock: 10 },
      { productId: product.id, price: 5, stock: 10 },
    ]).returning();
    await db.insert(schema.orderItemTable).values(variants.map((variant) => ({
      orderId: atStart.id!, productId: product.id, productVariantId: variant.id,
      quantity: 1, unitPriceAtSale: 5, productNameAtSale: product.name, lineTotal: 5,
    })));
    await db.insert(schema.deliveryTable).values([1, 2].map(() => ({
      orderId: atStart.id!, LogisticsType: "virtual" as const, GoodsAmount: 5,
    })));

    async function request(query: Record<string, string> = {}, rawQuery?: string) {
      const response = await fetch(`${baseUrl}/api/order/list?${rawQuery ?? new URLSearchParams(query)}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      return { status: response.status, body: await response.json() as any };
    }
    async function list(query: Record<string, string> = {}) {
      const result = await request(query);
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.equal(result.body.success, true);
      return result.body.data;
    }
    const ids = (data: any) => data.orders.map((order: any) => order.id);
    const tieIds = [fallback.id!, tied.id!].sort();
    const ascending = [atStart.id, ...tieIds, justBeforeEnd.id];
    const range = { startDate, endDate };
    const filtered = await list({ ...range, order: "asc" });
    assert.deepEqual(ids(filtered), ascending);
    assert.equal(filtered.total, 4);
    assert.equal(filtered.totalPages, 1);
    assert.equal(filtered.orders[0].items.length, 2);
    assert.equal(filtered.orders[0].deliveries.length, 2);
    assert.ok(filtered.orders[0].items[0].variantAtSale);
    assert.equal(filtered.orders[0].user, undefined);
    assert.deepEqual(ids(await list(range)), [...ascending].reverse());
    assert.deepEqual(ids(await list({ startDate, order: "asc" })), [...ascending, atEnd.id]);
    assert.deepEqual(ids(await list({ endDate, order: "asc" })), [beforeStart.id, ...ascending]);
    assert.deepEqual(ids(await list({
      startDate: "2026-09-29T00:00:00+08:00",
      endDate: "2026-09-30T00:00:00+08:00", order: "asc",
    })), ascending);
    assert.deepEqual(ids(await list({
      startDate: "2026-09-29T00:00:00.000000+08:00",
      endDate: "2026-09-29T00:00:00.000001+08:00",
    })), [atStart.id]);
    assert.deepEqual(ids(await list({
      startDate: "2026-09-28T16:00:00.000001Z",
      endDate: "2026-09-28T16:00:00.000002Z",
    })), []);

    for (const order of ["asc", "desc"]) {
      const page1 = await list({ ...range, order, page: "1", limit: "2" });
      const page2 = await list({ ...range, order, page: "2", limit: "2" });
      assert.deepEqual([...ids(page1), ...ids(page2)], order === "asc" ? ascending : [...ascending].reverse());
      assert.equal(page1.total, 4);
      assert.equal(page2.totalPages, 2);
      assert.deepEqual(ids(await list({ ...range, order, page: "3", limit: "2" })), []);
    }
    const legacyAscending = [beforeStart.id, tied.id, atStart.id, fallback.id, atEnd.id, justBeforeEnd.id];
    assert.deepEqual(ids(await list({ order: "asc" })), legacyAscending);
    assert.deepEqual(ids(await list()), [...legacyAscending].reverse());
    const empty = await list({ startDate: "2100-01-01T00:00:00Z" });
    assert.deepEqual(empty, { orders: [], total: 0, page: 1, limit: 10, totalPages: 0 });

    // Offset instants cover a DST-short day and calendar month/year rollovers.
    for (const bounds of [
      { startDate: "2026-03-08T00:00:00-05:00", endDate: "2026-03-09T00:00:00-04:00" },
      { startDate: "2026-12-31T00:00:00+08:00", endDate: "2027-01-01T00:00:00+08:00" },
      { startDate: "2026-09-30T00:00:00+08:00", endDate: "2026-10-01T00:00:00+08:00" },
    ]) {
      const [boundary] = await db.insert(schema.orderTable).values(fixture(bounds.startDate, null)).returning();
      const result = await list(bounds);
      assert.ok(ids(result).includes(boundary.id));
      await db.delete(schema.orderTable).where(eq(schema.orderTable.id, boundary.id));
    }

    for (const field of ["startDate", "endDate"]) {
      for (const invalid of ["", "2026-09-29", "2026-09-29T00:00:00", "2026-02-30T00:00:00Z", "2025-02-29T00:00:00Z", "2026-09-29T24:00:00Z", "2026-09-29T00:00:00+25:00", "not-a-date"]) {
        const result = await request({ [field]: invalid });
        assert.equal(result.status, 400, invalid);
        assert.equal(result.body.success, false);
        assert.equal(result.body.statusCode, 400);
        assert.ok(result.body.message.some((issue: any) => issue.field === field));
      }
      assert.equal((await request({}, `${field}=${startDate}&${field}=${endDate}`)).status, 400);
    }
    for (const bounds of [
      { startDate, endDate: startDate }, { startDate: endDate, endDate: startDate },
      { startDate, endDate: "2026-09-29T00:00:00+08:00" },
    ]) {
      const result = await request(bounds);
      assert.equal(result.status, 400);
      assert.deepEqual(result.body.message, [{ field: "endDate", message: "endDate must be later than startDate." }]);
    }
    assert.equal((await fetch(`${baseUrl}/api/order/list?${new URLSearchParams(range)}`)).status, 401);
    const otherResponse = await fetch(`${baseUrl}/api/order/list?${new URLSearchParams(range)}`, {
      headers: { authorization: `Bearer ${generateToken({ id: otherUser.id })}` },
    });
    assert.equal(otherResponse.status, 200);
    assert.deepEqual(ids((await otherResponse.json() as any).data), [foreign.id]);

    // Query parameters cannot widen or narrow the fixed app history statuses.
    for (const statusQuery of [
      "statusIn=pending&statusIn=paid",
      "statusIn=failed&statusIn=expired&statusIn=canceled",
      "statusIn=paid",
      "status=pending",
    ]) {
      for (const filteredQuery of [true, false]) {
        const override = await request({}, `${statusQuery}&order=asc&${filteredQuery ? new URLSearchParams(range) : ""}`);
        assert.equal(override.status, 200);
        assert.deepEqual(ids(override.body.data), filteredQuery ? ascending : legacyAscending);
        assert.equal(override.body.data.total, filteredQuery ? 4 : 6);
        assert.equal(override.body.data.totalPages, 1);
      }
    }
    await db.update(schema.orderTable).set({ completedAt: new Date(endDate), orderStatus: "paid" })
      .where(eq(schema.orderTable.id, fallback.id!));
    assert.ok(!ids(await list(range)).includes(fallback.id));
    const documentedPaths = Object.keys((swaggerSpec as any).paths);
    assert.ok(documentedPaths.includes("/api/admin/order/list"));
    assert.ok(documentedPaths.every((path) => path.startsWith("/api/admin/")));
    assert.equal((swaggerSpec as any).components.schemas.AppOrderListItem, undefined);
    // Inspect the core filter/sort plan on fixtures; staging workload profiling
    // is still needed before choosing an expression index.
    const plan = await db.execute(sql`
      explain (format json) select id from orders
      where user_id = ${user.id} and order_status in ('paid', 'payment-processing')
        and coalesce(completed_at, created_at) >= ${startDate}::timestamptz
        and coalesce(completed_at, created_at) < ${endDate}::timestamptz
      order by coalesce(completed_at, created_at) desc, id desc limit 10
    `);
    console.log("Fixture filter/sort plan:", JSON.stringify(plan[0]["QUERY PLAN"]));
    console.log("Order date filter API integration tests passed");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    await client.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

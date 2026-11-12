import "../lib/env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { eq, sql } from "drizzle-orm";
import app from "../app";
import db, { client } from "../lib/initDB";
import * as s from "../db/schema";
import { fixtureToken } from "./accountSessionFixture";
import { createRefundWithChatContext, updateRefundItemStatus } from "../repository/refund";
import { createDelivery, updateDeliveryWithNotificationContext, getDeliveryById } from "../repository/delivery";
import { createOrder, getOrderById, updateOrderStatus } from "../repository/order";
import { refundEligibility, getRefundWindowMs, getRefundExtensionMs, REFUND_WINDOW_MS, REFUND_EXTENSION_MS } from "../lib/refundEligibility";
import { swaggerSpec } from "../lib/swagger";
import ecpayService from "../services/ecpay";
import { createProduct, updateProduct } from "../repository/product";
import { sendRefundStatusChangedNotifications } from "../services/refund";

async function run() {
  assert.equal(process.env.TEST_DATABASE_MANAGED, "true");
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const documented = swaggerSpec as any;
    assert.equal(documented.paths["/api/admin/delivery/{deliveryId}/confirm-delivery"], undefined);
    assert.ok(documented.paths["/api/admin/delivery/{deliveryId}"].put);
    assert.ok(!("refundWindowHours" in documented.components.schemas.Product.properties));
    assert.equal(documented.components.schemas.ProductVariant.properties.refundWindowHours.default, 192);
    for (const [path, method] of [["/api/admin/product/create", "post"], ["/api/admin/product/{id}", "put"]]) {
      const fields = documented.paths[path][method].requestBody.content["application/json"].schema.properties;
      assert.ok(!("refundWindowHours" in fields));
      assert.equal(fields.variants.items.properties.refundWindowHours.nullable, true);
    }
    const [buyer, stranger] = await db.insert(s.userTable).values([1, 2].map(() => ({ email: `${randomUUID()}@example.test`, oauthProvider: "other" as const, oauthId: randomUUID(), referralCode: randomUUID() }))).returning();
    const accounts = await db.insert(s.accountTable).values((["seller", "seller", "admin", "employee"] as const).map(role => ({ role, email: `${randomUUID()}@example.test`, password: "unused", realName: "Refund test", phone: "0900000000", profileCompletedAt: new Date(), emailVerifiedAt: new Date() }))).returning();
    const [seller, foreignSeller, admin, employee] = accounts;
    const [group] = await db.insert(s.accountGroupTable).values({ parentId: seller.id }).returning();
    await db.update(s.accountTable).set({ accountGroupId: group.id }).where(eq(s.accountTable.id, employee.id));
    const [product] = await db.insert(s.productTable).values({ sellerId: seller.id, name: "Refund strategy", description: "Fixture" }).returning();
    const [variant] = await db.insert(s.productVariantTable).values({ productId: product.id, price: 100, stock: 30 }).returning();
    assert.equal(product.refundWindowDays, 8); // Retained legacy DB column.
    assert.equal(variant.refundWindowHours, 192);
    assert.equal(getRefundWindowMs(1), 60 * 60 * 1000);
    assert.equal(getRefundWindowMs(24), 24 * 60 * 60 * 1000);
    assert.equal(getRefundWindowMs(192), REFUND_WINDOW_MS);
    // Rehearse all pending upgrades only inside a rollback transaction on a disposable database.
    const variantMigration = readFileSync("drizzle/local/0120_variant_refund_windows.sql", "utf8");
    const hourMigration = readFileSync("drizzle/local/0121_refund_window_hours.sql", "utf8");
    assert.equal(variantMigration, readFileSync("drizzle/dev/0071_variant_refund_windows.sql", "utf8"));
    assert.equal(variantMigration, readFileSync("drizzle/stg/0019_variant_refund_windows.sql", "utf8"));
    assert.equal(hourMigration, readFileSync("drizzle/dev/0072_refund_window_hours.sql", "utf8"));
    assert.equal(hourMigration, readFileSync("drizzle/stg/0020_refund_window_hours.sql", "utf8"));
    const rollbackMigration = new Error("Rollback historical unit conversion verification");
    await assert.rejects(db.transaction(async tx => {
      const parents = await tx.insert(s.productTable).values([0, null, 3, 8, 50, 3650000].map(days => ({
        sellerId: seller.id, name: `Legacy parent ${days}`, description: "Fixture", refundWindowDays: days,
        status: days === null ? "inactive" as const : "active" as const, deletedAt: days === 50 ? new Date() : null,
      }))).returning();
      const variants = await tx.insert(s.productVariantTable).values(parents.flatMap(parent =>
        (["active", "inactive"] as const).map(status => ({ productId: parent.id, price: 100, stock: 10, status })))).returning();
      const [legacyOrder] = await tx.insert(s.orderTable).values({ userId: buyer.id, subTotal: 100, totalAmount: 100 }).returning();
      const start = new Date("2026-01-01T00:00:00Z");
      const deadline = new Date("2026-01-11T00:00:00Z");
      const [legacyItem] = await tx.insert(s.orderItemTable).values({ orderId: legacyOrder.id, productId: parents[0].id,
        productVariantId: variants[0].id, productNameAtSale: "Legacy", quantity: 1, unitPriceAtSale: 100, lineTotal: 100,
        refundWindowHoursAtSale: 240, refundWindowStartsAt: start, originalRefundDeadlineAt: deadline,
        refundDeadlineAt: new Date("2026-01-15T00:00:00Z") }).returning();
      // Recreate the product-policy-era shape, then apply the reviewed SQL sequence.
      await tx.execute(sql.raw("ALTER TABLE order_items DROP CONSTRAINT order_items_refund_window_ck"));
      await tx.execute(sql.raw("ALTER TABLE order_items DROP COLUMN refund_window_hours_at_sale"));
      await tx.execute(sql.raw("ALTER TABLE product_variants DROP COLUMN refund_window_hours"));
      await tx.execute(sql.raw("ALTER TABLE products DROP COLUMN refund_window_days"));
      await tx.execute(sql.raw("ALTER TABLE order_items ADD CONSTRAINT order_items_refund_window_ck CHECK (true)"));
      for (const statement of readFileSync("drizzle/local/0118_product_refund_windows.sql", "utf8").split("--> statement-breakpoint")) {
        if (statement.trim()) await tx.execute(sql.raw(statement));
      }
      for (const parent of parents) await tx.update(s.productTable).set({ refundWindowDays: parent.refundWindowDays }).where(eq(s.productTable.id, parent.id));
      for (const statement of variantMigration.split("--> statement-breakpoint")) {
        if (statement.trim()) await tx.execute(sql.raw(statement));
      }
      for (const variant of variants) {
        const [row] = await tx.execute<{ refund_window_days: number | null; status: string }>(sql`select refund_window_days,status from product_variants where id=${variant.id}`);
        assert.equal(row.refund_window_days, parents.find(p => p.id === variant.productId)!.refundWindowDays);
        assert.equal(row.status, variant.status);
      }
      const oldPolicyRows: { id: string; days: number | null }[] = [];
      for (const days of [0, null, 3]) {
        const id = randomUUID();
        const [oldPolicyOrder] = await tx.insert(s.orderTable).values({ userId: buyer.id, subTotal: 100, totalAmount: 100 }).returning();
        await tx.execute(sql`insert into order_items (id,order_id,product_id,product_variant_id,quantity,unit_price_at_sale,line_total,
          product_name_at_sale,refund_window_days_at_sale,refund_window_starts_at,original_refund_deadline_at,refund_deadline_at)
          values (${id},${oldPolicyOrder.id},${parents[0].id},${variants[0].id},1,100,100,'Old snapshot',${days},${start.toISOString()}::timestamptz,
          ${days ? deadline.toISOString() : null}::timestamptz,${days ? deadline.toISOString() : null}::timestamptz)`);
        oldPolicyRows.push({ id, days });
      }
      for (const statement of hourMigration.split("--> statement-breakpoint")) {
        if (statement.trim()) await tx.execute(sql.raw(statement));
      }
      for (const variant of variants) {
        const [row] = await tx.select().from(s.productVariantTable).where(eq(s.productVariantTable.id, variant.id));
        const days = parents.find(p => p.id === variant.productId)!.refundWindowDays;
        assert.equal(row.refundWindowHours, days === null ? null : days * 24);
        assert.equal(row.status, variant.status);
      }
      assert.deepEqual((await tx.select().from(s.orderItemTable).where(eq(s.orderItemTable.id, legacyItem.id)))[0], legacyItem,
        "10-day snapshot becomes 240 hours while receipt, original and extended deadlines stay exact");
      for (const old of oldPolicyRows) {
        const [converted] = await tx.select().from(s.orderItemTable).where(eq(s.orderItemTable.id, old.id));
        assert.equal(converted.refundWindowHoursAtSale, old.days === null ? null : old.days * 24);
        assert.deepEqual(converted.refundWindowStartsAt, start);
        assert.deepEqual(converted.refundDeadlineAt, old.days ? deadline : null);
      }
      const [futureVariant] = await tx.insert(s.productVariantTable).values({ productId: parents[0].id, price: 100, stock: 10 }).returning();
      assert.equal(futureVariant.refundWindowHours, 192, "Future variants default to 192 hours, not the parent's legacy 0 days");
      const [futureOrder] = await tx.insert(s.orderTable).values({ userId: buyer.id, subTotal: 100, totalAmount: 100 }).returning();
      const [futureItem] = await tx.insert(s.orderItemTable).values({ orderId: futureOrder.id, productId: parents[0].id,
        productVariantId: futureVariant.id, quantity: 1, unitPriceAtSale: 100, lineTotal: 100, productNameAtSale: "Future" }).returning();
      assert.equal(futureItem.refundWindowHoursAtSale, 192);
      throw rollbackMigration;
    }), error => error === rollbackMigration);
    async function fixture(quantity = 2) {
      const [order] = await db.insert(s.orderTable).values({ userId: buyer.id, subTotal: quantity * 100, totalAmount: quantity * 100, orderStatus: "paid", completedAt: new Date(), discountCoin: 0 }).returning();
      const [item] = await db.insert(s.orderItemTable).values({ orderId: order.id, productId: product.id, productVariantId: variant.id, quantity, unitPriceAtSale: 100, lineTotal: quantity * 100, productNameAtSale: product.name }).returning();
      const delivery = await createDelivery({ orderId: order.id, LogisticsType: "CVS", LogisticsSubType: "UNIMARTC2C", GoodsAmount: quantity * 100, status: "delivered", RtnCode: "2073", RtnMsg: "Store arrival" }, [{ productId: product.id, variantId: variant.id }], "provider_callback");
      return { order, item, delivery };
    }
    const requestTokens = new Map<string, string>();
    async function request(path: string, id: string, method = "GET", body?: unknown) {
      const token = requestTokens.get(id) ?? await fixtureToken({ id });
      requestTokens.set(id, token);
      const r = await fetch(base + path, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await r.text(); let data: any; try { data = JSON.parse(text); } catch { data = text; }
      return { status: r.status, data };
    }
    async function picked(f: Awaited<ReturnType<typeof fixture>>) {
      await updateDeliveryWithNotificationContext(f.delivery.id, { status: "delivered", RtnCode: "2067", RtnMsg: "Picked up" }, undefined, "provider_poll");
      return (await db.query.orderItemTable.findFirst({ where: eq(s.orderItemTable.id, f.item.id) }))!;
    }
    // Exercise the real checkout snapshot and mixed-policy receipt path.
    const [policyProduct] = await db.insert(s.productTable).values({
      sellerId: seller.id, name: "Mixed variant policies", description: "Fixture", refundWindowDays: 99,
    }).returning();
    const policyVariants = await db.insert(s.productVariantTable).values([0, 3, 7, 10, 50, null].map(days => ({
      productId: policyProduct.id, name: `Policy ${days}`, price: 100, stock: 10, refundWindowHours: days,
    }))).returning();
    const policyOrder = await createOrder({
      orderData: { userId: buyer.id, subTotal: 1200, totalAmount: 1200 },
      items: policyVariants.map(v => ({ productId: v.productId, productVariantId: v.id,
        quantity: 2, unitPriceAtSale: 100, productNameAtSale: policyProduct.name, refundWindowHoursAtSale: 99, deliveryId: randomUUID(),
        refundWindowStartsAt: new Date(), originalRefundDeadlineAt: new Date("2099-01-01"), refundDeadlineAt: new Date("2099-01-01") })),
      idempotencyKey: randomUUID(),
    });
    assert.ok(policyOrder);
    const beforeReceipt = await db.query.orderItemTable.findMany({ where: eq(s.orderItemTable.orderId, policyOrder.id) });
    assert.ok(beforeReceipt.every(row => row.refundWindowStartsAt === null && row.refundDeadlineAt === null && row.deliveryId === null));
    // Changes before payment must not replace the policy captured at order creation.
    await db.update(s.productVariantTable).set({ refundWindowHours: 1 }).where(eq(s.productVariantTable.productId, policyProduct.id));
    await db.update(s.productTable).set({ refundWindowDays: 2 }).where(eq(s.productTable.id, policyProduct.id));
    await updateOrderStatus({ orderId: policyOrder.id, status: "paid" });
    const policyDelivery = await createDelivery({ orderId: policyOrder.id, LogisticsType: "home_delivery", GoodsAmount: 1200, status: "delivered" },
      policyVariants.map(v => ({ productId: v.productId, variantId: v.id })), "provider_callback");
    const policyItems = (await getOrderById(policyOrder.id))!.items;
    for (const v of policyVariants) {
      const row = policyItems.find(i => i.productVariantId === v.id)!;
      assert.equal(row.refundWindowHoursAtSale, v.refundWindowHours);
      assert.ok(row.refundWindowStartsAt);
      if (v.refundWindowHours === 0 || v.refundWindowHours === null) assert.equal(row.refundDeadlineAt, null);
      else assert.equal(row.refundDeadlineAt!.getTime() - row.refundWindowStartsAt!.getTime(), getRefundWindowMs(v.refundWindowHours));
      assert.equal(row.canRefund, v.refundWindowHours !== 0);
    }
    assert.equal(refundEligibility("paid", { ...policyItems.find(i => i.refundWindowHoursAtSale === null)!, refundWindowStartsAt: null }, [], new Date(), "delivered").refundBlockReason, "RECEIPT_TIME_UNKNOWN");
    const disabled = policyItems.find(i => i.refundWindowHoursAtSale === 0)!;
    const disabledRequest = await request("/api/refund", buyer.id, "POST", { orderItemId: disabled.id, quantity: 1 });
    assert.equal(disabledRequest.status, 409);
    assert.equal(disabledRequest.data.code, "REFUNDS_DISABLED");
    assert.equal(disabled.refundWindowStatus, "disabled");
    const unlimited = policyItems.find(i => i.refundWindowHoursAtSale === null)!;
    assert.equal(refundEligibility("paid", unlimited, [], new Date("2099-01-01")).canRefund, true);
    const unlimitedInput = { orderItemId: unlimited.id, quantity: 1, reason: "Unlimited", actor: { kind: "user" as const, id: buyer.id } };
    const unlimitedRefund = await createRefundWithChatContext(unlimitedInput);
    await updateRefundItemStatus(unlimitedRefund.refundItem.id, { quantity: 2, agreement: { confirmed: true, note: "Agreed" } }, seller.id);
    const unlimitedRejection = await updateRefundItemStatus(unlimitedRefund.refundItem.id, { status: "rejected", rejectionReason: "Review" }, seller.id);
    assert.equal(unlimitedRejection.refundItem.rejectionDeadlineBefore, null);
    assert.equal(unlimitedRejection.refundItem.rejectionDeadlineAfter, null);
    assert.ok(unlimitedRejection.refundItem.rejectedAt);
    assert.ok(unlimitedRejection.notificationContext);
    const statusEmails: { to: string; subject: string; html: string }[] = [];
    await sendRefundStatusChangedNotifications(unlimitedRejection.notificationContext, {
      sendEmail: async input => { statusEmails.push(input); return { success: true }; },
      getFcmTokensInUserIds: async () => [],
      sendMulticastPushNotification: async () => undefined,
    });
    assert.equal(statusEmails.length, 1);
    assert.equal(statusEmails[0].to, buyer.email);
    assert.ok(statusEmails[0].html.includes("不限期"));
    // App notification failure must not prevent the independent email attempt.
    const loggedFailures: unknown[][] = [];
    const originalConsoleError = console.error;
    console.error = (...args: unknown[]) => { loggedFailures.push(args); };
    try {
      await sendRefundStatusChangedNotifications({ ...unlimitedRejection.notificationContext,
        refundWindowHoursAtSale: 8, refundDeadlineAt: new Date("2026-11-04T04:10:35Z"),
      }, {
        sendEmail: async input => { statusEmails.push(input); return { success: true }; },
        createNotification: async () => { throw new Error("Simulated app notification failure"); },
      });
    } finally { console.error = originalConsoleError; }
    assert.equal(statusEmails.length, 2);
    assert.ok(statusEmails[1].html.includes("2026-11-04 12:10"));
    assert.ok(loggedFailures.some(args => String(args[0]).includes("app notification")));
    await sendRefundStatusChangedNotifications({ ...unlimitedRejection.notificationContext, status: "completed" }, {
      sendEmail: async input => { statusEmails.push(input); return { success: true }; },
      getFcmTokensInUserIds: async () => [],
      sendMulticastPushNotification: async () => undefined,
    });
    assert.equal(statusEmails.length, 3);
    assert.ok(statusEmails[2].html.includes("已完成"));
    assert.ok(!statusEmails[2].html.includes("重新提出"));

    assert.equal(unlimitedRejection.notificationContext?.refundDeadlineAt, null);
    assert.equal(unlimitedRejection.notificationContext?.refundWindowHoursAtSale, null);
    await updateRefundItemStatus(unlimitedRefund.refundItem.id, { status: "rejected", rejectionReason: "Review" }, seller.id);
    await createRefundWithChatContext(unlimitedInput);
    assert.equal((await getDeliveryById(policyDelivery.id))!.items.find(i => i.id === unlimited.id)!.refundDeadlineAt, null);
    // Variant writes preserve explicit null/zero and reject retired root writes.
    for (const days of [null, 0, 7]) {
      const result = await request(`/api/admin/product/${product.id}`, seller.id, "PUT", { variants: [{ id: variant.id, refundWindowHours: days }] });
      assert.equal(result.status, 200, JSON.stringify(result));
      assert.equal(result.data.data.variants.find((v: any) => v.id === variant.id).refundWindowHours, days);
      assert.ok(!("refundWindowHours" in result.data.data));
      const oldRoot = await request(`/api/admin/product/${product.id}`, seller.id, "PUT", { refundWindowHours: days });
      assert.equal(oldRoot.status, 400);
      assert.equal(oldRoot.data.code, "VALIDATION_FAILED");
      assert.equal(oldRoot.data.fieldErrors[0].field, "refundWindowHours");
    }
    for (const days of [-1, 1.5, "7", false, 87600001]) {
      const result = await request(`/api/admin/product/${product.id}`, seller.id, "PUT", { variants: [{ id: variant.id, refundWindowHours: days }] });
      assert.equal(result.status, 400);
      assert.equal(result.data.fieldErrors[0].field, "variants.0.refundWindowHours");
    }
    const retiredVariantDays = await request(`/api/admin/product/${product.id}`, seller.id, "PUT", {
      variants: [{ id: variant.id, refundWindowDays: 7 }],
    });
    assert.equal(retiredVariantDays.status, 400);
    assert.equal(retiredVariantDays.data.fieldErrors[0].field, "variants.0.refundWindowDays");
    assert.equal((await request(`/api/admin/product/${product.id}`, seller.id, "PUT", { refundWindowDays: 7 })).status, 400);
    const omitted = await request(`/api/admin/product/${product.id}`, seller.id, "PUT", { variants: [{ id: variant.id, stock: 30 }] });
    assert.equal(omitted.data.data.variants[0].refundWindowHours, 7);
    const createBody = { sellerId: seller.id, name: "Variant policy API", description: "Fixture",
      variants: [{ price: 100, stock: 10, refundWindowHours: null }] };
    const createdProduct = await request("/api/admin/product/create", seller.id, "POST", createBody);
    assert.equal(createdProduct.status, 200, JSON.stringify(createdProduct));
    assert.equal(createdProduct.data.data.variants[0].refundWindowHours, null);
    assert.ok(!("refundWindowHours" in createdProduct.data.data));
    await assert.rejects(createProduct({ sellerId: seller.id, name: "Legacy caller", description: "Fixture", refundWindowDays: null }),
      (error: any) => error.statusCode === 400 && error.code === "VALIDATION_FAILED");
    await assert.rejects(updateProduct(product.id, { refundWindowDays: 0 }),
      (error: any) => error.statusCode === 400 && error.code === "VALIDATION_FAILED");
    const deletedPolicyProduct = await request(`/api/admin/product/${createdProduct.data.data.id}`, seller.id, "DELETE");
    assert.equal(deletedPolicyProduct.status, 200);
    assert.ok(!("refundWindowHours" in deletedPolicyProduct.data.data));
    const retiredCreate = await request("/api/admin/product/create", seller.id, "POST", { ...createBody, refundWindowHours: 8 });
    assert.equal(retiredCreate.status, 400);
    const newDefault = await request("/api/admin/product/create", seller.id, "POST", { ...createBody, variants: [{ price: 100, stock: 10 }] });
    assert.equal(newDefault.status, 200);
    assert.equal(newDefault.data.data.variants[0].refundWindowHours, 192);
    // Adding a variant to a legacy unlimited product still defaults to 192 hours, never inherits.
    await db.update(s.productTable).set({ refundWindowDays: null }).where(eq(s.productTable.id, policyProduct.id));
    const newVariant = await request(`/api/admin/product/${policyProduct.id}`, seller.id, "PUT", { variants: [
      { name: "Added later", price: 100, stock: 10, optionValues: {} },
    ] });
    assert.equal(newVariant.status, 200, JSON.stringify(newVariant));
    assert.equal(newVariant.data.data.variants.find((v: any) => v.name === "Added later").refundWindowHours, 192);
    const restoredPolicy = await request(`/api/admin/product/${policyProduct.id}`, seller.id, "PUT", {
      variants: policyVariants.map(v => ({ id: v.id, refundWindowHours: v.refundWindowHours })),
    });
    assert.equal(restoredPolicy.status, 200);
    const siblingEdit = await request(`/api/admin/product/${policyProduct.id}`, seller.id, "PUT", {
      variants: [{ id: policyVariants[0].id, refundWindowHours: 30 }],
    });
    assert.equal(siblingEdit.status, 200);
    assert.equal(siblingEdit.data.data.variants.find((v: any) => v.id === policyVariants[5].id).refundWindowHours, null);
    assert.equal((await getOrderById(policyOrder.id))!.items.find(i => i.productVariantId === policyVariants[0].id)!.refundWindowHoursAtSale, 0);
    await request(`/api/admin/product/${policyProduct.id}`, seller.id, "PUT", { variants: [{ id: policyVariants[0].id, refundWindowHours: 0 }] });
    const appProduct = await request(`/api/product/${policyProduct.id}`, buyer.id);
    assert.ok(!("refundWindowHours" in appProduct.data.data));
    assert.ok(appProduct.data.data.variants.every((v: any) => "refundWindowHours" in v));
    const listProduct = await request("/api/admin/product/list", seller.id);
    assert.ok(listProduct.data.data.products.every((p: any) => !("refundWindowHours" in p) && p.variants.every((v: any) => "refundWindowHours" in v)));
    for (const selected of [policyVariants[0], policyVariants[5]]) {
      const cartWrite = await request("/api/cart/item", buyer.id, "POST", {
        productId: selected.productId, productVariantId: selected.id, quantity: 1,
      });
      assert.equal(cartWrite.status, 200, JSON.stringify(cartWrite));
    }
    const cart = await request("/api/cart/list", buyer.id);
    assert.equal(cart.status, 200);
    const cartItems = cart.data.data;
    for (const selected of [policyVariants[0], policyVariants[5]]) {
      const cartItem = cartItems.find((i: any) => i.productVariantId === selected.id);
      assert.equal(cartItem.variant.refundWindowHours, selected.refundWindowHours);
      assert.ok(!("refundWindowHours" in cartItem.product));
    }
    await db.update(s.productVariantTable).set({ refundWindowHours: 192 }).where(eq(s.productVariantTable.id, variant.id));
    const f = await fixture();
    assert.equal(f.delivery.receivedAt, null);
    assert.equal(f.delivery.status, "ready_for_pickup");
    assert.equal((await request("/api/refund", buyer.id, "POST", { orderItemId: f.item.id, quantity: 1 })).status, 409);
    let item = await picked(f);
    assert.equal(item.refundDeadlineAt!.getTime() - item.refundWindowStartsAt!.getTime(), REFUND_WINDOW_MS);
    assert.deepEqual((await picked(f)).refundDeadlineAt, item.refundDeadlineAt);
    await updateDeliveryWithNotificationContext(f.delivery.id, { status: "delivered", RtnCode: "2073" }, undefined, "provider_callback");
    assert.deepEqual((await picked(f)).refundDeadlineAt, item.refundDeadlineAt);
    assert.equal(refundEligibility("paid", item, [], item.refundDeadlineAt!).canRefund, false);
    assert.equal(refundEligibility("paid", item, [], new Date(item.refundDeadlineAt!.getTime() - 1)).canRefund, true);
    for (const body of [{ extraRefundAmount: 0 }, { refundAmount: 1 }, { status: "completed" }, { metadata: { audit: true } }]) {
      assert.equal((await request("/api/refund", buyer.id, "POST", { orderItemId: item.id, quantity: 1, ...body })).status, 400);
    }
    for (const actor of accounts) {
      assert.equal((await request("/api/admin/refund", actor.id, "POST", { orderItemId: item.id, quantity: 1 })).status, 404);
      const denied = await request("/api/refund", actor.id, "POST", { orderItemId: item.id, quantity: 1 });
      assert.ok([401, 403].includes(denied.status));
    }
    assert.equal((await request("/api/refund", stranger.id, "POST", { orderItemId: item.id, quantity: 1 })).status, 404);
    await assert.rejects(createRefundWithChatContext({ orderItemId: item.id, quantity: 1, reason: "x", actor: { kind: "account", id: admin.id } }));
    await assert.rejects(createRefundWithChatContext({ orderItemId: item.id, quantity: 1, reason: "x", actor: { kind: "user", id: buyer.id }, extraRefundAmount: 100 } as any));
    const key = randomUUID();
    const payload = { orderItemId: item.id, quantity: 2, reason: "Please refund", clientRequestId: key };
    const [one, two] = await Promise.all([request("/api/refund", buyer.id, "POST", payload), request("/api/refund", buyer.id, "POST", payload)]);
    assert.equal(one.status, 200, JSON.stringify(one)); assert.equal(two.status, 200, JSON.stringify(two));
    const refund = one.data.data; assert.equal(refund.id, two.data.data.id); assert.equal(refund.extraRefundAmount, 0); assert.equal(refund.originalRequest.quantity, 2);
    assert.equal((await request("/api/refund", buyer.id, "POST", { ...payload, quantity: 1 })).status, 409);
    assert.equal((await request("/api/refund", buyer.id, "POST", { orderItemId: item.id, quantity: 1 })).status, 400);
    const patch = `/api/admin/refund/${refund.id}/status`;
    for (const actor of [buyer, stranger, foreignSeller, employee]) assert.notEqual((await request(patch, actor.id, "PATCH", { status: "processing" })).status, 200);
    assert.equal((await request(`/api/refund/${refund.id}/status`, buyer.id, "PATCH", { status: "completed" })).status, 404);
    assert.equal((await request(patch, seller.id, "PATCH", { quantity: 1 })).status, 409);
    const changed = await request(patch, seller.id, "PATCH", { quantity: 1, extraRefundAmount: 10, agreement: { confirmed: true, note: "Buyer agreed in order chat" } });
    assert.equal(changed.status, 200, JSON.stringify(changed)); assert.equal(changed.data.data.quantity, 1); assert.equal(changed.data.data.originalRequest.quantity, 2);
    const adjustmentLogs = await db.query.refundLogTable.findMany({ where: eq(s.refundLogTable.refundItemId, refund.id) });
    const adjustment = adjustmentLogs.find(log => (log.audit as any)?.agreement);
    assert.equal(adjustment?.actorAccountId, seller.id);
    assert.equal((adjustment?.audit as any).before.quantity, 2);
    assert.equal((adjustment?.audit as any).after.quantity, 1);
    assert.equal((await request(patch, seller.id, "PATCH", { status: "rejected" })).status, 400);
    assert.equal((await request(patch, seller.id, "PATCH", { status: "rejected", rejectionReason: "x", quantity: 1 })).status, 400);
    const rejection = { status: "rejected", rejectionReason: "Unable to agree" };
    // Move the effective window to an already elapsed original deadline; accepted requests survive.
    const oldStart = new Date(Date.now() - 12 * 86400000), oldDeadline = new Date(oldStart.getTime() + REFUND_WINDOW_MS);
    await db.update(s.orderItemTable).set({ refundWindowStartsAt: oldStart, originalRefundDeadlineAt: oldDeadline, refundDeadlineAt: oldDeadline }).where(eq(s.orderItemTable.id, item.id));
    assert.equal((await request("/api/refund", buyer.id, "POST", payload)).status, 200); // replay after expiry
    const rejected = await request(patch, seller.id, "PATCH", rejection); assert.equal(rejected.status, 200, JSON.stringify(rejected));
    const rejectedData = rejected.data.data;
    assert.equal(new Date(rejectedData.rejectionDeadlineAfter).getTime() - new Date(rejectedData.rejectedAt).getTime(), REFUND_EXTENSION_MS);
    const logsBefore = await db.query.refundLogTable.findMany({ where: eq(s.refundLogTable.refundItemId, refund.id) });
    assert.equal((await request(patch, seller.id, "PATCH", rejection)).status, 200);
    assert.equal((await db.query.refundLogTable.findMany({ where: eq(s.refundLogTable.refundItemId, refund.id) })).length, logsBefore.length);
    assert.equal((await request(patch, admin.id, "PATCH", { status: "completed" })).status, 409);
    const again = await request("/api/refund", buyer.id, "POST", { orderItemId: item.id, quantity: 2 }); assert.equal(again.status, 200, JSON.stringify(again));
    const againPatch = `/api/admin/refund/${again.data.data.id}/status`;
    assert.equal((await request(againPatch, admin.id, "PATCH", rejection)).status, 200);
    const repeated = (await db.query.orderItemTable.findFirst({ where: eq(s.orderItemTable.id, item.id) }))!;
    assert.ok(repeated.refundDeadlineAt!.getTime() >= new Date(rejectedData.rejectionDeadlineAfter).getTime());
    const detail = await getOrderById(f.order.id, { userId: buyer.id, includeUser: false });
    assert.equal(detail!.items[0].remainingRefundQuantity, 2); assert.equal(detail!.items[0].canRefund, true);
    assert.equal((await getDeliveryById(f.delivery.id))!.items[0].canRefund, true);
    // Early rejection cannot shorten a later deadline.
    const early = await fixture(1); const earlyItem = await picked(early);
    const earlyRefund = await createRefundWithChatContext({ orderItemId: earlyItem.id, quantity: 1, reason: "x", actor: { kind: "user", id: buyer.id } });
    await updateRefundItemStatus(earlyRefund.refundItem.id, { status: "rejected", rejectionReason: "x" }, seller.id);
    assert.deepEqual((await db.query.orderItemTable.findFirst({ where: eq(s.orderItemTable.id, earlyItem.id) }))!.refundDeadlineAt, earlyItem.refundDeadlineAt);
    // Agreed partial completion does not extend and never refunds the completed unit again.
    const partial = await fixture(2); const partialItem = await picked(partial);
    const partialRefund = await createRefundWithChatContext({ orderItemId: partialItem.id, quantity: 2, reason: "x", actor: { kind: "user", id: buyer.id } });
    const partialUpdates = { quantity: 1, status: "completed" as const, extraRefundAmount: 2, agreement: { confirmed: true as const, note: "Chat agreement" } };
    const complete = await updateRefundItemStatus(partialRefund.refundItem.id, partialUpdates, admin.id);
    assert.equal(complete.refundItem.cashRefundAmount, 102);
    const stockAfter = (await db.query.productVariantTable.findFirst({ where: eq(s.productVariantTable.id, variant.id) }))!.stock;
    await updateRefundItemStatus(partialRefund.refundItem.id, partialUpdates, admin.id);
    assert.equal((await db.query.productVariantTable.findFirst({ where: eq(s.productVariantTable.id, variant.id) }))!.stock, stockAfter);
    const finalPartial = (await db.query.orderItemTable.findFirst({ where: eq(s.orderItemTable.id, partialItem.id) }))!;
    assert.deepEqual(finalPartial.refundDeadlineAt, partialItem.refundDeadlineAt);
    const rest = await createRefundWithChatContext({ orderItemId: partialItem.id, quantity: 1, reason: "Remaining unit", actor: { kind: "user", id: buyer.id } });
    await updateRefundItemStatus(rest.refundItem.id, { status: "cancelled" }, seller.id);
    assert.deepEqual((await db.query.orderItemTable.findFirst({ where: eq(s.orderItemTable.id, partialItem.id) }))!.refundDeadlineAt, partialItem.refundDeadlineAt);
    // Unkeyed concurrent requests still cannot claim more than the purchased quantity.
    const race = await fixture(1);
    await picked(race);
    const raced = await Promise.all([1, 2].map(() => request("/api/refund", buyer.id, "POST", { orderItemId: race.item.id, quantity: 1 })));
    assert.deepEqual(raced.map(result => result.status).sort(), [200, 400]);

    // An accepted request can finish after expiry; a new request or quantity increase cannot.
    const late = await fixture(2);
    await picked(late);
    const lateRefund = await createRefundWithChatContext({ orderItemId: late.item.id, quantity: 1, reason: "x", actor: { kind: "user", id: buyer.id } });
    await db.update(s.orderItemTable).set({ refundWindowStartsAt: oldStart, originalRefundDeadlineAt: oldDeadline, refundDeadlineAt: oldDeadline }).where(eq(s.orderItemTable.id, late.item.id));
    const lateNew = await request("/api/refund", buyer.id, "POST", { orderItemId: late.item.id, quantity: 1 });
    assert.equal(lateNew.status, 409);
    assert.equal(lateNew.data.code, "REFUND_WINDOW_EXPIRED");
    await assert.rejects(updateRefundItemStatus(lateRefund.refundItem.id, { quantity: 2, agreement: { confirmed: true, note: "Agreed" } }, seller.id), (error: any) => error.code === "REFUND_WINDOW_EXPIRED");
    await updateRefundItemStatus(lateRefund.refundItem.id, { status: "completed" }, seller.id);
    assert.equal((await getOrderById(late.order.id))!.items[0].canRefund, false);

    // Signed callback creation and duplicate updates both initialize/preserve the window.
    const callback = await fixture(1);
    const tradeNo = randomUUID().replace(/-/g, "").slice(0, 20);
    await db.insert(s.merchantTradeTable).values({ orderId: callback.order.id, merchantTradeNo: tradeNo, productIds: [product.id], variantIds: [variant.id] });
    async function sendCallback(merchantTradeNo: string, code: string, valid = true) {
      const body = { MerchantTradeNo: merchantTradeNo, LogisticsType: "CVS", LogisticsSubType: "UNIMARTC2C", RtnCode: code, RtnMsg: "Fixture", AllPayLogisticsID: "123456789", GoodsAmount: "100" };
      const mac = valid ? ecpayService.generateCheckValue(body, process.env.LOGISTICS_HASH_KEY!, process.env.LOGISTICS_HASH_IV!, "md5") : "invalid";
      return fetch(base + "/api/ecpay/express/server-reply", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...body, CheckMacValue: mac }) });
    }
    assert.equal((await sendCallback(tradeNo, "2067", false)).status, 400);
    assert.equal((await sendCallback(tradeNo, "2073")).status, 200);
    assert.equal((await db.query.orderItemTable.findFirst({ where: eq(s.orderItemTable.id, callback.item.id) }))!.refundDeadlineAt, null);
    assert.equal((await sendCallback(tradeNo, "2067")).status, 200);
    const callbackItem = (await db.query.orderItemTable.findFirst({ where: eq(s.orderItemTable.id, callback.item.id) }))!;
    assert.ok(callbackItem.refundWindowStartsAt);
    assert.equal((await sendCallback(tradeNo, "2067")).status, 200);
    assert.deepEqual((await db.query.orderItemTable.findFirst({ where: eq(s.orderItemTable.id, callback.item.id) }))!.refundDeadlineAt, callbackItem.refundDeadlineAt);
    assert.equal((await sendCallback("unknown-trade", "2067")).status, 500);

    // Existing CVS status edits cannot manufacture receipt evidence; historical delivered logs remain unknown.
    const unknown = await fixture(1);
    await updateDeliveryWithNotificationContext(unknown.delivery.id, { status: "delivered", RtnCode: "2067" }, seller.id);
    await updateDeliveryWithNotificationContext(unknown.delivery.id, { status: "delivered", RtnCode: "2067" }, undefined, "provider_poll");
    assert.equal((await db.query.orderItemTable.findFirst({ where: eq(s.orderItemTable.id, unknown.item.id) }))!.refundDeadlineAt, null);
    assert.equal((await getOrderById(unknown.order.id))!.items[0].refundWindowStatus, "unknown");
    const noLog = await fixture(1);
    await db.update(s.deliveryTable).set({ status: "delivered", RtnCode: "2067" }).where(eq(s.deliveryTable.id, noLog.delivery.id));
    await db.delete(s.deliveryLogTable).where(eq(s.deliveryLogTable.deliveryId, noLog.delivery.id));
    await updateDeliveryWithNotificationContext(noLog.delivery.id, { status: "delivered", RtnCode: "2067" }, undefined, "provider_poll");
    assert.equal((await db.query.orderItemTable.findFirst({ where: eq(s.orderItemTable.id, noLog.item.id) }))!.refundDeadlineAt, null);

    // Newly created receipt captures the window for its linked items in the same transaction.
    const fresh = await fixture(1);
    await createDelivery({ orderId: fresh.order.id, LogisticsType: "home_delivery", GoodsAmount: 100, status: "delivered" }, [{ productId: product.id, variantId: variant.id }], "provider_callback");
    assert.ok((await db.query.orderItemTable.findFirst({ where: eq(s.orderItemTable.id, fresh.item.id) }))!.refundDeadlineAt);
    // Manual delivery confirmation is real receipt evidence, including in stg/prod (never payment fallback).
    async function manualFixture(kind: "virtual" | "home_delivery" | "CVS" = "virtual") {
      const [manualProduct] = await db.insert(s.productTable).values({ sellerId: seller.id,
        name: `Manual ${kind}`, description: "Fixture", type: kind === "virtual" ? "virtual" : "normal" }).returning();
      const variants = await db.insert(s.productVariantTable).values([0, 3, null].map(days => ({
        productId: manualProduct.id, name: `Policy ${days}`, refundWindowHours: days, price: 100, stock: 10,
      }))).returning();
      const selection = { LogisticsType: kind, products: variants.map(v => ({ productId: v.productId, variantId: v.id })) };
      const [order] = await db.insert(s.orderTable).values({ userId: buyer.id, orderStatus: "paid", completedAt: new Date(),
        subTotal: 600, totalAmount: 600, shippingInfo: kind === "CVS" ? { cvsPickupGroup: [selection] } : { nonCvsPickupGroup: [selection] } }).returning();
      const items = await db.insert(s.orderItemTable).values(variants.map(v => ({ orderId: order.id, productId: v.productId,
        productVariantId: v.id, productNameAtSale: manualProduct.name, quantity: 2, unitPriceAtSale: 100, lineTotal: 200,
        refundWindowHoursAtSale: v.refundWindowHours }))).returning();
      const delivery = await createDelivery({ orderId: order.id, LogisticsType: kind, status: "pending", GoodsAmount: 600 }, selection.products);
      return { order, items, delivery };
    }
    for (const id of [seller.id, foreignSeller.id, admin.id, employee.id, buyer.id]) requestTokens.set(id, await fixtureToken({ id }));
    const beforeManualEnvironment = process.env.NODE_ENV;
    try {
      for (const environment of ["stg", "production"]) {
        process.env.NODE_ENV = environment;
        for (const kind of ["virtual", "home_delivery"] as const) {
          const manual = await manualFixture(kind);
          const confirmPath = `/api/admin/delivery/${manual.delivery.id}`;
          const beforeDelivery = (await getDeliveryById(manual.delivery.id))!;
          assert.equal(beforeDelivery.receivedAt, null);
          assert.equal(beforeDelivery.items.find(i => i.refundWindowHoursAtSale === 3)!.refundBlockReason, "NOT_RECEIVED");
          assert.equal((await request(confirmPath, employee.id, "PUT", { status: "delivered" })).status, 403);
          assert.equal((await request(confirmPath, foreignSeller.id, "PUT", { status: "delivered" })).status, 404);
          assert.ok([401, 403].includes((await request(confirmPath, buyer.id, "PUT", { status: "delivered" })).status));
          const decisions = await Promise.all([1, 2].map(() => request(confirmPath, seller.id, "PUT", { status: "delivered" })));
          assert.ok(decisions.every(r => r.status === 200), JSON.stringify(decisions));
          const confirmed = decisions[0].data.data;
          assert.equal(confirmed.status, "delivered");
          assert.ok(confirmed.receivedAt);
          assert.equal(confirmed.receiptEvidence.source, "seller_confirmation");
          assert.equal(confirmed.receiptEvidence.actorAccountId, seller.id);
          assert.equal(confirmed.receiptEvidence.actorRole, "seller");
          assert.equal(confirmed.receiptEvidence.estimated, false);
          for (const status of ["pending", "shipped", "ready_for_pickup", "cancelled", "returned"]) {
            const downgrade = await request(confirmPath, seller.id, "PUT", { status });
            assert.equal(downgrade.status, 409);
            assert.equal(downgrade.data.code, "DELIVERY_TERMINAL");
          }
          const changeType = await request(confirmPath, admin.id, "PUT", { LogisticsType: kind === "virtual" ? "home_delivery" : "virtual" });
          assert.equal(changeType.status, 409); assert.equal(changeType.data.code, "DELIVERY_TERMINAL");
          const forgedReceipt = await request(confirmPath, seller.id, "PUT", { status: "delivered", receivedAt: "2020-01-01",
            receiptEvidence: { source: "admin_confirmation" } });
          assert.equal(forgedReceipt.status, 200);
          assert.equal(forgedReceipt.data.data.receivedAt, confirmed.receivedAt);
          assert.deepEqual(forgedReceipt.data.data.receiptEvidence, confirmed.receiptEvidence);
          const start = new Date(confirmed.receivedAt).getTime();
          for (const purchased of confirmed.items) {
            assert.equal(purchased.refundWindowSource, "receipt");
            assert.equal(purchased.refundReceiptChecksBypassed, false);
            assert.equal(new Date(purchased.refundWindowStartsAt).getTime(), start);
            if (purchased.refundWindowHoursAtSale === 3) {
              assert.equal(new Date(purchased.refundDeadlineAt).getTime() - start, 3 * 60 * 60 * 1000);
              assert.equal(purchased.canRefund, true);
            } else if (purchased.refundWindowHoursAtSale === null) {
              assert.equal(purchased.refundDeadlineAt, null);
              assert.equal(purchased.canRefund, true);
            } else {
              assert.equal(purchased.refundBlockReason, "REFUNDS_DISABLED");
              assert.equal(purchased.canRefund, false);
            }
          }
          const auditRows = await db.query.adminActivityEventTable.findMany({ where: eq(s.adminActivityEventTable.entityId, manual.delivery.id) });
          assert.equal(auditRows.filter(row => row.eventType === "delivery.confirmed").length, 1, "Concurrent confirms audit once");
          const logCount = (await db.query.deliveryLogTable.findMany({ where: eq(s.deliveryLogTable.deliveryId, manual.delivery.id) })).length;
          const finite = confirmed.items.find((i: any) => i.refundWindowHoursAtSale === 3);
          const accepted = await request("/api/refund", buyer.id, "POST", { orderItemId: finite.id, quantity: 1 });
          assert.equal(accepted.status, 200, JSON.stringify(accepted));
          const rejected = await request(`/api/admin/refund/${accepted.data.data.id}/status`, seller.id, "PATCH", { status: "rejected", rejectionReason: "Test extension" });
          assert.equal(rejected.status, 200);
          const extended = await getDeliveryById(manual.delivery.id);
          const repeatedConfirmation = await request(confirmPath, admin.id, "PUT", { status: "delivered", metadata: { comment: "Editable metadata" } });
          assert.equal(repeatedConfirmation.status, 200);
          assert.deepEqual(repeatedConfirmation.data.data.receiptEvidence, confirmed.receiptEvidence);
          assert.deepEqual(repeatedConfirmation.data.data.items.map((i: any) => i.refundDeadlineAt), extended!.items.map(i => i.refundDeadlineAt?.toISOString() ?? null));
          assert.equal((await db.query.deliveryLogTable.findMany({ where: eq(s.deliveryLogTable.deliveryId, manual.delivery.id) })).length, logCount);
        }
      }
      // CVS keeps its prior update/poll semantics; only its original receipt clock remains immutable.
      const pickedUp = await manualFixture("CVS");
      await updateDeliveryWithNotificationContext(pickedUp.delivery.id, { status: "delivered", RtnCode: "2067", LogisticsSubType: "UNIMARTC2C" }, undefined, "provider_callback");
      const pickedUpAt = (await getDeliveryById(pickedUp.delivery.id))!.receivedAt;
      const existingCvsUpdate = await request(`/api/admin/delivery/${pickedUp.delivery.id}`, seller.id, "PUT", { status: "shipped" });
      assert.equal(existingCvsUpdate.status, 200, "New manual-delivery terminal guard must not alter CVS status edits");
      await updateDeliveryWithNotificationContext(pickedUp.delivery.id, { status: "delivered", RtnCode: "2073", RtnMsg: "Store arrival" }, undefined, "provider_callback");
      const cvsArrival = (await getDeliveryById(pickedUp.delivery.id))!;
      assert.equal(cvsArrival.status, "ready_for_pickup");
      assert.deepEqual(cvsArrival.receivedAt, pickedUpAt, "Existing CVS receipt timestamps are still never reset");
      await updateDeliveryWithNotificationContext(pickedUp.delivery.id, { status: "delivered", RtnCode: "2067", RtnMsg: "Picked up" }, undefined, "provider_poll");
      assert.equal((await getDeliveryById(pickedUp.delivery.id))!.status, "delivered");
      assert.deepEqual((await getDeliveryById(pickedUp.delivery.id))!.receivedAt, pickedUpAt);
      const legacyManual = await manualFixture("virtual");
      await db.update(s.deliveryTable).set({ status: "delivered" }).where(eq(s.deliveryTable.id, legacyManual.delivery.id));
      const legacyComplete = await request(`/api/admin/delivery/${legacyManual.delivery.id}`, seller.id, "PUT", { status: "delivered" });
      assert.equal(legacyComplete.status, 200); assert.ok(legacyComplete.data.data.receivedAt);
      const adminManual = await manualFixture("home_delivery");
      const adminPath = `/api/admin/delivery/${adminManual.delivery.id}`;
      const adminConfirmed = await request(adminPath, admin.id, "PUT", { status: "delivered" });
      assert.equal(adminConfirmed.status, 200);
      assert.equal(adminConfirmed.data.data.receiptEvidence.source, "admin_confirmation");
      assert.equal(adminConfirmed.data.data.receiptEvidence.actorAccountId, admin.id);
      const unpaid = await manualFixture();
      await db.update(s.orderTable).set({ orderStatus: "payment-processing" }).where(eq(s.orderTable.id, unpaid.order.id));
      const notPaid = await request(`/api/admin/delivery/${unpaid.delivery.id}`, seller.id, "PUT", { status: "delivered" });
      assert.equal(notPaid.status, 409); assert.equal(notPaid.data.code, "ORDER_NOT_PAID");
      const cvs = await manualFixture("CVS");
      const cvsPath = `/api/admin/delivery/${cvs.delivery.id}`;
      const cvsManual = await request(cvsPath, seller.id, "PUT", { status: "delivered" });
      assert.equal(cvsManual.status, 200, "Existing CVS status API stays unchanged");
      assert.equal(cvsManual.data.data.receivedAt, null, "A CVS status edit still cannot manufacture trusted pickup evidence");
      await updateDeliveryWithNotificationContext(cvs.delivery.id, { LogisticsType: "virtual" });
      assert.equal((await request(cvsPath, seller.id, "PUT", { status: "delivered" })).data.code, "DELIVERY_CONFIRMATION_NOT_SUPPORTED", "Changing type cannot bypass CVS pickup");
      const cancelled = await manualFixture();
      await updateDeliveryWithNotificationContext(cancelled.delivery.id, { status: "cancelled" });
      assert.equal((await request(`/api/admin/delivery/${cancelled.delivery.id}`, seller.id, "PUT", { status: "delivered" })).data.code, "DELIVERY_NOT_CONFIRMABLE");
      const noSnapshot = await manualFixture();
      await db.update(s.orderTable).set({ shippingInfo: null }).where(eq(s.orderTable.id, noSnapshot.order.id));
      assert.equal((await request(`/api/admin/delivery/${noSnapshot.delivery.id}`, admin.id, "PUT", { status: "delivered" })).data.code, "DELIVERY_CONFIRMATION_NOT_SUPPORTED");
      const rollback = await manualFixture();
      const rollbackPath = `/api/admin/delivery/${rollback.delivery.id}`;
      await client.unsafe("CREATE FUNCTION fail_manual_confirmation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type = 'delivery.confirmed' THEN RAISE EXCEPTION 'test manual delivery rollback'; END IF; RETURN NEW; END $$");
      await client.unsafe("CREATE TRIGGER fail_manual_confirmation BEFORE INSERT ON admin_activity_events FOR EACH ROW EXECUTE FUNCTION fail_manual_confirmation()");
      try {
        assert.equal((await request(rollbackPath, admin.id, "PUT", { status: "delivered" })).status, 500);
      } finally {
        await client.unsafe("DROP TRIGGER fail_manual_confirmation ON admin_activity_events");
        await client.unsafe("DROP FUNCTION fail_manual_confirmation()");
      }
      const rolledBack = (await getDeliveryById(rollback.delivery.id))!;
      assert.equal(rolledBack.status, "pending");
      assert.equal(rolledBack.receivedAt, null);
      assert.ok(rolledBack.items.every(i => i.refundWindowStartsAt === null));
      assert.equal(rolledBack.logs.length, 0);
      assert.equal((await request(rollbackPath, admin.id, "PUT", { status: "delivered" })).status, 200);
    } finally {
      if (beforeManualEnvironment === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = beforeManualEnvironment;
    }
    // Only explicit local/development environments relax receipt checks; DB remains disposable.
    const originalEnvironment = process.env.NODE_ENV;
    try {
      for (const environment of ["local", "development"]) {
        process.env.NODE_ENV = environment;
        assert.equal(getRefundWindowMs(), REFUND_WINDOW_MS / 10);
        assert.equal(getRefundExtensionMs(), 12 * 60 * 60 * 1000);
        for (const days of [0, 1, 12, 24, 192, 720, null]) {
          const testItem = { ...f.item, deliveryId: null, refundWindowHoursAtSale: days };
          const paidAt = new Date();
          const effective = refundEligibility("paid", testItem, [], paidAt, undefined, paidAt);
          assert.equal(effective.canRefund, days !== 0);
          if (days !== null && days > 0) {
            assert.equal(effective.refundDeadlineAt!.getTime() - paidAt.getTime(), days * 3600000 / 10);
          } else assert.equal(effective.refundDeadlineAt, null);
        }
        const unlimitedTesting = await fixture(2);
        await db.update(s.orderTable).set({ completedAt: new Date(Date.now() - 60000) }).where(eq(s.orderTable.id, unlimitedTesting.order.id));
        await db.update(s.orderItemTable).set({ refundWindowHoursAtSale: null, deliveryId: null }).where(eq(s.orderItemTable.id, unlimitedTesting.item.id));
        const unlimitedTestRefund = await createRefundWithChatContext({ ...unlimitedInput, orderItemId: unlimitedTesting.item.id });
        const unlimitedTestRejection = await updateRefundItemStatus(unlimitedTestRefund.refundItem.id, { status: "rejected", rejectionReason: "Testing" }, seller.id);
        assert.equal(unlimitedTestRejection.refundItem.rejectionDeadlineAfter, null);
        assert.equal((await getOrderById(unlimitedTesting.order.id))!.items[0].canRefund, true);

        const receiptTesting = await fixture(1);
        const receiptItem = await picked(receiptTesting);
        assert.equal(receiptItem.refundDeadlineAt!.getTime() - receiptItem.refundWindowStartsAt!.getTime(), REFUND_WINDOW_MS / 10);
        assert.deepEqual((await picked(receiptTesting)).refundDeadlineAt, receiptItem.refundDeadlineAt);
        const earlyRequest = await createRefundWithChatContext({ orderItemId: receiptItem.id, quantity: 1, reason: "Receipt-window test", actor: { kind: "user", id: buyer.id } });
        const earlyRejection = await updateRefundItemStatus(earlyRequest.refundItem.id, { status: "rejected", rejectionReason: "Early rejection" }, seller.id);
        assert.deepEqual(earlyRejection.refundItem.rejectionDeadlineAfter, receiptItem.refundDeadlineAt);
        assert.deepEqual(earlyRejection.notificationContext?.refundDeadlineAt, receiptItem.refundDeadlineAt);
        const testing = await fixture(3);
        const paidAt = new Date(Date.now() - 18 * 60 * 60 * 1000);
        const createdAt = new Date(Date.now() - 20 * 86400000);
        await db.update(s.orderTable).set({ completedAt: paidAt, createdAt }).where(eq(s.orderTable.id, testing.order.id));
        await db.update(s.orderItemTable).set({ deliveryId: null }).where(eq(s.orderItemTable.id, testing.item.id));
        const prePickup = (await getOrderById(testing.order.id))!.items[0];
        assert.equal(prePickup.canRefund, true);
        assert.equal(prePickup.refundReceiptChecksBypassed, true);
        assert.equal(prePickup.refundWindowSource, "payment_for_testing");
        assert.equal(prePickup.refundWindowStartsAt!.getTime(), paidAt.getTime());
        assert.equal(prePickup.originalRefundDeadlineAt!.getTime(), paidAt.getTime() + REFUND_WINDOW_MS / 10);
        assert.equal(prePickup.refundWindowStatus, "open");
        assert.equal(prePickup.remainingRefundQuantity, 3);
        assert.equal(refundEligibility("paid", testing.item, [], prePickup.refundDeadlineAt!, undefined, paidAt).canRefund, false);
        assert.equal(refundEligibility("paid", testing.item, [], new Date(prePickup.refundDeadlineAt!.getTime() - 1), undefined, paidAt).canRefund, true);
        // A duplicate payment confirmation cannot restart the policy window.
        await updateOrderStatus({ orderId: testing.order.id, status: "paid" });
        assert.equal((await getOrderById(testing.order.id))!.completedAt!.getTime(), paidAt.getTime());
        const input = { orderItemId: testing.item.id, quantity: 1, reason: "Pre-pickup testing", actor: { kind: "user" as const, id: buyer.id } };
        const testingRefund = await createRefundWithChatContext(input);
        await updateRefundItemStatus(testingRefund.refundItem.id, { quantity: 2, agreement: { confirmed: true, note: "Buyer agreement" } }, seller.id);
        await assert.rejects(createRefundWithChatContext({ ...input, quantity: 2 }), (error: any) => error.statusCode === 400);
        await assert.rejects(createRefundWithChatContext({ ...input, actor: { kind: "user", id: stranger.id } }), (error: any) => error.statusCode === 404);
        await assert.rejects(updateRefundItemStatus(testingRefund.refundItem.id, { status: "rejected", rejectionReason: "Test" }, foreignSeller.id), (error: any) => error.statusCode === 404);
        const testingRejection = await updateRefundItemStatus(testingRefund.refundItem.id, { status: "rejected", rejectionReason: "Test" }, seller.id);
        assert.equal(testingRejection.refundItem.rejectionDeadlineBefore!.getTime(), prePickup.refundDeadlineAt!.getTime());
        assert.equal(testingRejection.refundItem.rejectionDeadlineAfter!.getTime(), testingRejection.refundItem.rejectedAt!.getTime() + 12 * 60 * 60 * 1000);
        assert.deepEqual(testingRejection.notificationContext?.refundDeadlineAt, testingRejection.refundItem.rejectionDeadlineAfter);
        assert.equal(testingRejection.notificationContext?.rejectionReason, "Test");
        const repeated = await updateRefundItemStatus(testingRefund.refundItem.id, { status: "rejected", rejectionReason: "Test" }, seller.id);
        assert.deepEqual(repeated.refundItem.rejectionDeadlineAfter, testingRejection.refundItem.rejectionDeadlineAfter);
        assert.deepEqual((await getOrderById(testing.order.id))!.items[0].refundDeadlineAt, testingRejection.refundItem.rejectionDeadlineAfter);
        const stored = (await db.query.orderItemTable.findFirst({ where: eq(s.orderItemTable.id, testing.item.id) }))!;
        assert.equal(stored.refundWindowStartsAt, null);
        assert.equal(stored.refundDeadlineAt, null);
        await createRefundWithChatContext(input);

        await db.update(s.orderTable).set({ orderStatus: "pending" }).where(eq(s.orderTable.id, testing.order.id));
        assert.equal((await getOrderById(testing.order.id))!.items[0].refundBlockReason, "ORDER_NOT_PAID");
        await assert.rejects(createRefundWithChatContext(input), (error: any) => error.code === "ORDER_NOT_PAID");
        await db.update(s.orderTable).set({ orderStatus: "paid" }).where(eq(s.orderTable.id, testing.order.id));
        // A real pickup window takes precedence, even over a later testing rejection.
        await db.update(s.orderItemTable).set({ deliveryId: testing.delivery.id, refundWindowStartsAt: oldStart, originalRefundDeadlineAt: oldDeadline, refundDeadlineAt: oldDeadline }).where(eq(s.orderItemTable.id, testing.item.id));
        const expiredTesting = (await getOrderById(testing.order.id))!.items[0];
        assert.equal(expiredTesting.refundWindowSource, "receipt");
        assert.equal(expiredTesting.refundWindowStatus, "expired");
        assert.equal(expiredTesting.canRefund, false);
        assert.equal((await getDeliveryById(testing.delivery.id))!.items[0].canRefund, false);
        await assert.rejects(createRefundWithChatContext(input), (error: any) => error.code === "REFUND_WINDOW_EXPIRED");

        const paymentWindow = await fixture(3);
        const paymentInput = { ...input, orderItemId: paymentWindow.item.id, clientRequestId: randomUUID() };
        const accepted = await createRefundWithChatContext(paymentInput);
        await db.update(s.orderTable).set({ completedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) }).where(eq(s.orderTable.id, paymentWindow.order.id));
        const expiredPayment = (await getOrderById(paymentWindow.order.id))!.items[0];
        assert.equal(expiredPayment.refundWindowStatus, "expired");
        assert.equal(expiredPayment.canRefund, false);
        assert.equal((await getDeliveryById(paymentWindow.delivery.id))!.items[0].canRefund, false);
        await assert.rejects(createRefundWithChatContext({ ...paymentInput, clientRequestId: randomUUID() }), (error: any) => error.code === "REFUND_WINDOW_EXPIRED");
        await assert.rejects(updateRefundItemStatus(accepted.refundItem.id, { quantity: 2, agreement: { confirmed: true, note: "Too late" } }, seller.id), (error: any) => error.code === "REFUND_WINDOW_EXPIRED");
        assert.equal((await createRefundWithChatContext(paymentInput)).refundItem.id, accepted.refundItem.id);
        // Accepted requests remain reviewable after expiry; rejection opens a persisted 12-hour window.
        const lateRejection = await updateRefundItemStatus(accepted.refundItem.id, { status: "rejected", rejectionReason: "Reviewed after deadline" }, seller.id);
        const renewed = (await getOrderById(paymentWindow.order.id))!.items[0];
        assert.equal(renewed.canRefund, true);
        assert.equal(lateRejection.refundItem.rejectionDeadlineAfter!.getTime() - lateRejection.refundItem.rejectedAt!.getTime(), 12 * 60 * 60 * 1000);
        assert.deepEqual(renewed.refundDeadlineAt, lateRejection.refundItem.rejectionDeadlineAfter);
        assert.deepEqual((await getDeliveryById(paymentWindow.delivery.id))!.items[0].refundDeadlineAt, renewed.refundDeadlineAt);
        await createRefundWithChatContext({ ...paymentInput, clientRequestId: randomUUID() });
        // Legacy paid rows with missing payment time cannot use creation/deployment time as a substitute.
        const missingPayment = await fixture(1);
        await db.update(s.orderTable).set({ completedAt: null }).where(eq(s.orderTable.id, missingPayment.order.id));
        assert.equal((await getOrderById(missingPayment.order.id))!.items[0].refundBlockReason, "PAYMENT_TIME_UNKNOWN");
        await assert.rejects(createRefundWithChatContext({ ...input, orderItemId: missingPayment.item.id }), (error: any) => error.code === "PAYMENT_TIME_UNKNOWN");
        // First payment confirmation initializes the existing payment timestamp, then keeps it stable.
        const confirmed = await updateOrderStatus({ orderId: missingPayment.order.id, status: "paid" });
        assert.ok(confirmed!.completedAt);
        const confirmedAgain = await updateOrderStatus({ orderId: missingPayment.order.id, status: "paid" });
        assert.deepEqual(confirmedAgain!.completedAt, confirmed!.completedAt);

      }
      for (const environment of ["stg", "production", "test", "unknown", undefined]) {
        if (environment === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = environment;
        assert.equal(getRefundWindowMs(), REFUND_WINDOW_MS);
        assert.equal(getRefundExtensionMs(), 120 * 60 * 60 * 1000);
        const noReceipt = { ...f.item, deliveryId: null };
        assert.equal(refundEligibility("paid", noReceipt, [], new Date(), undefined, new Date()).canRefund, false);
        assert.equal(refundEligibility("paid", noReceipt, []).refundReceiptChecksBypassed, false);
        assert.equal(refundEligibility("paid", item, [], item.refundDeadlineAt!).canRefund, false);
        await assert.rejects(createRefundWithChatContext({ orderItemId: unknown.item.id, quantity: 1, reason: "No receipt", actor: { kind: "user", id: buyer.id } }), (error: any) => error.code === "RECEIPT_TIME_UNKNOWN");
      }
    } finally {
      if (originalEnvironment === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalEnvironment;
    }
    const spec = swaggerSpec as any; assert.equal(spec.paths["/api/admin/refund"]?.post, undefined); assert.equal(spec.paths["/api/refund"], undefined);
    console.log("Refund strategy integration passed: pickup windows, permissions, partial completion, unlimited rejection renewal, quantity safety, audit, retry and expiry.");
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await client.end({ timeout: 5 }); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });

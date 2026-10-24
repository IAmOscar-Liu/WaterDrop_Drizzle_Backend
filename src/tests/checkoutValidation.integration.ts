import "../lib/env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { eq, sql } from "drizzle-orm";
import app from "../app";
import db, { client } from "../lib/initDB";
import * as s from "../db/schema";
import { fixtureToken } from "./accountSessionFixture";
import { listCartItems } from "../repository/cart";
import { createOrder } from "../repository/order";
import { evaluateCheckout } from "../lib/checkoutValidation";
import { swaggerSpec } from "../lib/swagger";

async function run() {
  assert.equal(process.env.TEST_DATABASE_MANAGED, "true");
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const [buyer, stranger] = await db.insert(s.userTable).values([1, 2].map(() => ({
      email: `${randomUUID()}@example.test`, oauthProvider: "other" as const,
      oauthId: randomUUID(), referralCode: randomUUID(),
    }))).returning();
    const [seller] = await db.insert(s.accountTable).values({
      role: "seller", email: `${randomUUID()}@example.test`, password: "unused",
      profileCompletedAt: new Date(), emailVerifiedAt: new Date(),
    }).returning();
    const [product, otherProduct] = await db.insert(s.productTable).values([1, 2].map((n) => ({
      sellerId: seller.id, name: `Checkout ${n}`, description: "Fixture",
    }))).returning();
    const [variant, secondVariant, otherVariant] = await db.insert(s.productVariantTable).values([
      { productId: product.id, price: 99.125, stock: 3, reserve: 1 },
      { productId: product.id, name: "Blue", price: 120, stock: 100 },
      { productId: otherProduct.id, price: 10, stock: 10 },
    ]).returning();
    const [cart, secondCart, foreignCart] = await db.insert(s.cartItemTable).values([
      { userId: buyer.id, productId: product.id, productVariantId: variant.id, quantity: 2 },
      { userId: buyer.id, productId: product.id, productVariantId: secondVariant.id, quantity: 1 },
      { userId: stranger.id, productId: otherProduct.id, productVariantId: otherVariant.id, quantity: 1 },
    ]).returning();
    const items = [
      { cartItemId: cart.id, productVariantId: variant.id, quantity: 2, expectedUnitPrice: 99.125 },
      { cartItemId: secondCart.id, productVariantId: secondVariant.id, quantity: 1, expectedUnitPrice: 120 },
    ];
    async function request(body: unknown, id: string | null = buyer.id) {
      const r = await fetch(base + "/api/cart/validate-checkout", {
        method: "POST", headers: { "content-type": "application/json",
          ...(id ? { authorization: `Bearer ${await fixtureToken({ id })}` } : {}) },
        body: JSON.stringify(body),
      });
      return { status: r.status, body: await r.json() as any };
    }
    function codes(result: any, index = 0) {
      return result.body.data.items[index].issues.map((entry: any) => entry.code);
    }
    const before = await listCartItems(buyer.id);
    const first = await request({ items });
    assert.equal(first.status, 200);
    assert.equal(first.body.data.canCheckout, true);
    assert.equal(first.body.data.items[0].availableStock, 2); // Not the product's aggregate stock.
    assert.equal(first.body.data.items[0].variantName, null); // Default unnamed variant.
    assert.deepEqual(first.body.data.cartItems, JSON.parse(JSON.stringify(before)));
    assert.ok(Number.isFinite(Date.parse(first.body.data.checkedAt)));
    assert.deepEqual(await listCartItems(buyer.id), before); // No cart/stock mutation.
    assert.equal((await db.select({ total: sql<number>`count(*)::int` }).from(s.orderTable))[0].total, 0);
    assert.equal((await request({ items }, null)).status, 401);
    assert.equal((await request({ items }, randomUUID())).status, 401);
    assert.equal((await request({ items }, seller.id)).status, 403);
    for (const body of [
      {}, { items: [] }, { items, userId: buyer.id }, { items: Array(5).fill(items[0]) },
      { items: [items[0], items[0]] },
      { items: [items[0], { ...items[1], productVariantId: variant.id }] },
      ...[0, -1, 1.5, "2", 2_147_483_648].map((quantity) => ({ items: [{ ...items[0], quantity }] })),
      ...[-1, null, "99.125"].map((expectedUnitPrice) => ({ items: [{ ...items[0], expectedUnitPrice }] })),
      { items: [{ ...items[0], userId: buyer.id }] },
      { items: [{ ...items[0], cartItemId: "invalid" }] },
    ]) assert.equal((await request(body)).status, 400, JSON.stringify(body));
    assert.equal((await request({ items: items.map((item) => ({ ...item,
      cartItemId: item.cartItemId.toUpperCase(), productVariantId: item.productVariantId.toUpperCase(),
    })) })).body.data.canCheckout, true);

    const foreign = await request({ items: [{ ...items[0], cartItemId: foreignCart.id }] });
    const missing = await request({ items: [{ ...items[0], cartItemId: randomUUID() }] });
    assert.deepEqual(codes(foreign), ["CART_ITEM_UNAVAILABLE"]);
    assert.deepEqual(codes(foreign), codes(missing));
    for (const key of ["productId", "productVariantId", "productName", "variantName", "currentQuantity", "currentUnitPrice", "availableStock"]) {
      assert.equal(foreign.body.data.items[0][key], null);
    }
    assert.equal(foreign.body.data.cartItems.length, 2);
    assert.ok(!JSON.stringify(foreign.body.data.cartItems).includes(foreignCart.id));
    const partialSet = await request({ items: [items[0]] });
    assert.equal(partialSet.body.data.canCheckout, false);
    assert.equal(partialSet.body.data.issues[0].code, "CART_SELECTION_CHANGED");
    await db.update(s.cartItemTable).set({ checked: false }).where(eq(s.cartItemTable.id, secondCart.id));
    assert.ok(codes(await request({ items }), 1).includes("CART_SELECTION_CHANGED"));
    const selectedOnly = await request({ items: [items[0]] });
    assert.equal(selectedOnly.body.data.canCheckout, true);
    assert.equal(selectedOnly.body.data.cartItems.length, 2); // Includes unchecked rows.
    await db.update(s.cartItemTable).set({ checked: true }).where(eq(s.cartItemTable.id, secondCart.id));
    assert.ok(codes(await request({ items: [{ ...items[0], quantity: 1 }, items[1]] })).includes("CART_ITEM_CHANGED"));
    assert.ok(codes(await request({ items: [{ ...items[0], productVariantId: otherVariant.id }, items[1]] })).includes("CART_ITEM_CHANGED"));
    await db.update(s.productVariantTable).set({ price: 100, reserve: 2 }).where(eq(s.productVariantTable.id, variant.id));
    const stale = await request({ items });
    assert.deepEqual(codes(stale), ["PRICE_CHANGED", "INSUFFICIENT_STOCK"]);
    assert.equal(stale.body.data.items[0].currentUnitPrice, 100);
    assert.equal(stale.body.data.items[0].availableStock, 1);
    await db.update(s.productVariantTable).set({ reserve: 3, status: "inactive" }).where(eq(s.productVariantTable.id, variant.id));
    const inactive = await request({ items });
    assert.ok(codes(inactive).includes("VARIANT_UNAVAILABLE"));
    assert.equal(inactive.body.data.items[0].availableStock, 0);
    await db.update(s.productTable).set({ status: "inactive" }).where(eq(s.productTable.id, product.id));
    assert.ok(codes(await request({ items })).includes("PRODUCT_UNAVAILABLE"));
    await db.update(s.productTable).set({ status: "active", deletedAt: new Date() }).where(eq(s.productTable.id, product.id));
    assert.ok(codes(await request({ items })).includes("PRODUCT_UNAVAILABLE"));
    await db.update(s.productTable).set({ deletedAt: null }).where(eq(s.productTable.id, product.id));
    await db.update(s.productVariantTable).set({ price: 99.125, reserve: 1, status: "active" }).where(eq(s.productVariantTable.id, variant.id));
    // Legacy bad relation: the variant must belong to the cart's product.
    await db.update(s.cartItemTable).set({ productId: otherProduct.id }).where(eq(s.cartItemTable.id, cart.id));
    const mismatch = await request({ items });
    assert.ok(codes(mismatch).includes("VARIANT_UNAVAILABLE"));
    assert.equal(mismatch.body.data.items[0].availableStock, null);
    await db.update(s.cartItemTable).set({ productId: product.id }).where(eq(s.cartItemTable.id, cart.id));

    // Defensive evaluation of unavailable data (constraints normally prevent these rows).
    const snapshot = await listCartItems(buyer.id);
    for (const invalid of [null, undefined, NaN]) {
      const broken = snapshot.map((row) => row.id === cart.id
        ? { ...row, variant: { ...row.variant, stock: invalid } } : row);
      const result = evaluateCheckout(items, broken as typeof snapshot);
      const item = result.items[0];
      assert.equal(result.canCheckout, false);
      assert.equal(item.availableStock, null);
      assert.ok(item.issues.some((entry) => entry.code === "STOCK_UNAVAILABLE"));
    }
    const invalidPrice = snapshot.map((row) => row.id === cart.id
      ? { ...row, variant: { ...row.variant, price: NaN } } : row);
    assert.ok(evaluateCheckout(items, invalidPrice).items[0].issues.some((entry) => entry.code === "PRICE_UNAVAILABLE"));

    // Repeatable-read cart reads stay on one snapshot across another connection's commit.
    await db.transaction(async (tx) => {
      const initial = await listCartItems(buyer.id, tx);
      await db.update(s.productVariantTable).set({ reserve: 2 }).where(eq(s.productVariantTable.id, variant.id));
      assert.deepEqual(await listCartItems(buyer.id, tx), initial);
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
    // A successful precheck is no reservation: a later stock change blocks order creation.
    await assert.rejects(createOrder({
      orderData: { userId: buyer.id, subTotal: 198.25, totalAmount: 198.25 },
      items: [{ productId: product.id, productVariantId: variant.id, quantity: 2,
        unitPriceAtSale: 99.125, productNameAtSale: product.name }],
      idempotencyKey: randomUUID(),
    }), /Insufficient stock/);
    assert.equal((await db.select({ total: sql<number>`count(*)::int` }).from(s.orderTable))[0].total, 0);

    // A storage failure must fail the request, never return a business pass.
    await client.unsafe('ALTER TABLE cart_items RENAME TO cart_items_checkout_test_hidden');
    try {
      const failure = await request({ items });
      assert.equal(failure.status, 500);
      assert.equal(failure.body.success, false);
    } finally {
      await client.unsafe('ALTER TABLE cart_items_checkout_test_hidden RENAME TO cart_items');
    }
    await db.delete(s.cartItemTable).where(eq(s.cartItemTable.userId, buyer.id));
    const empty = await request({ items });
    assert.equal(empty.body.data.canCheckout, false);
    assert.deepEqual(empty.body.data.cartItems, []);
    assert.equal((swaggerSpec as any).paths["/api/cart/validate-checkout"], undefined);
    console.log("Checkout validation: isolation, ownership, validation, stale state, stock, read-only and failure checks passed.");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await client.end();
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });

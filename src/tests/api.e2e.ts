import "../lib/env";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { and, eq, inArray } from "drizzle-orm";
import app from "../app";
import * as schema from "../db/schema";
import { getLocalDate, getLocalMonth } from "../lib/coinAccounting";
import db, { client } from "../lib/initDB";
import {
  generateAdminAccessToken,
  generateToken,
  validateToken,
} from "../lib/token";
import { expireUserCoinLots } from "../repository/coinLedger";
import ecpayService from "../services/ecpay";

type ApiEnvelope = {
  success: boolean;
  statusCode?: number;
  message?: unknown;
  data?: any;
};

async function run() {
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.NO_CRON, "true");
  assert.equal(process.env.COIN_LEDGER_ENABLED, "true");
  assert.equal(process.env.TEST_DATABASE_MANAGED, "true");

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  async function request(
    route: string,
    options: {
      method?: string;
      token?: string;
      cookie?: string;
      body?: unknown;
    } = {},
  ) {
    const response = await fetch(`${baseUrl}${route}`, {
      method: options.method ?? "GET",
      headers: {
        ...(options.token
          ? { authorization: `Bearer ${options.token}` }
          : {}),
        ...(options.cookie ? { cookie: options.cookie } : {}),
        ...(options.body === undefined
          ? {}
          : { "content-type": "application/json" }),
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const json = (await response.json()) as ApiEnvelope;
    return { status: response.status, json, headers: response.headers };
  }

  function expectSuccess(
    result: Awaited<ReturnType<typeof request>>,
    expectedStatus = 200,
  ) {
    assert.equal(result.status, expectedStatus, JSON.stringify(result.json));
    assert.equal(result.json.success, true, JSON.stringify(result.json));
    return result.json.data;
  }

  async function waitFor(
    predicate: () => Promise<boolean>,
    description: string,
  ) {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (await predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for ${description}.`);
  }

  async function login(label: string) {
    const result = await request("/api/auth/login", {
      method: "POST",
      body: {
        name: `API User ${label}`,
        email: `api-${label}@example.test`,
        oauthProvider: "other",
        oauthId: `api-${label}`,
        timezone: "Asia/Taipei",
      },
    });
    const data = expectSuccess(result);
    assert.equal(typeof data.token, "string");
    return data as { token: string; user: schema.User; isNewUser: boolean };
  }

  try {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const [seller] = await db
      .insert(schema.accountTable)
      .values({
        email: `api-seller-${suffix}@example.test`,
        password: "not-used",
        realName: "API Test Seller",
        role: "seller",
        phone: "0900000000",
      })
      .returning();
    const sellerToken = generateToken(seller);
    assert.ok(sellerToken);
    const decodedSellerToken = validateToken(sellerToken);
    assert.ok(decodedSellerToken && typeof decodedSellerToken !== "string");
    assert.ok(decodedSellerToken.iat && decodedSellerToken.exp);
    assert.equal(
      decodedSellerToken.exp - decodedSellerToken.iat,
      30 * 24 * 60 * 60,
    );
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "local";
    const localAdminToken = generateAdminAccessToken(seller);
    process.env.NODE_ENV = originalNodeEnv;
    const decodedLocalAdminToken = validateToken(localAdminToken);
    assert.ok(
      decodedLocalAdminToken && typeof decodedLocalAdminToken !== "string",
    );
    assert.ok(decodedLocalAdminToken.iat && decodedLocalAdminToken.exp);
    assert.equal(
      decodedLocalAdminToken.exp - decodedLocalAdminToken.iat,
      24 * 60 * 60,
    );

    const [admin, otherSeller] = await db
      .insert(schema.accountTable)
      .values([
        {
          email: `api-admin-${suffix}@example.test`,
          password: "not-used",
          realName: "API Test Admin",
          role: "admin" as const,
          phone: "0900000001",
        },
        {
          email: `api-other-seller-${suffix}@example.test`,
          password: "not-used",
          realName: "API Other Seller",
          role: "seller" as const,
          phone: "0900000002",
        },
      ])
      .returning();
    const adminToken = generateToken(admin)!;
    const otherSellerToken = generateToken(otherSeller)!;

    await db.insert(schema.accountWalletTable).values([
      { accountId: seller.id },
      { accountId: admin.id },
      { accountId: otherSeller.id },
    ]);

    const [accountGroup] = await db
      .insert(schema.accountGroupTable)
      .values({ parentId: seller.id })
      .returning();

    const registration = await request("/api/admin/account/register", {
      method: "POST",
      body: {
        name: "API Registered Seller",
        realName: "測試商家",
        email: `api-registered-${suffix}@example.test`,
        password: "Password123!",
        phone: "0912345678",
      },
    });
    const registrationData = expectSuccess(registration);
    const registeredWallet = await db.query.accountWalletTable.findFirst({
      where: eq(
        schema.accountWalletTable.accountId,
        registrationData.user.id,
      ),
    });
    assert.equal(registeredWallet?.walletBalance, "0.00");
    const registeredAccessToken = validateToken(registrationData.token);
    assert.ok(
      registeredAccessToken && typeof registeredAccessToken !== "string",
    );
    assert.ok(registeredAccessToken.iat && registeredAccessToken.exp);
    assert.equal(
      registeredAccessToken.exp - registeredAccessToken.iat,
      60 * 60,
    );
    const refreshSetCookie = registration.headers.get("set-cookie");
    assert.ok(refreshSetCookie);
    const refreshCookie = refreshSetCookie.split(";")[0];
    const refreshToken = refreshCookie.slice(refreshCookie.indexOf("=") + 1);
    const decodedRefreshToken = validateToken(refreshToken);
    assert.ok(decodedRefreshToken && typeof decodedRefreshToken !== "string");
    assert.ok(decodedRefreshToken.iat && decodedRefreshToken.exp);
    assert.equal(
      decodedRefreshToken.exp - decodedRefreshToken.iat,
      30 * 24 * 60 * 60,
    );
    assert.match(refreshSetCookie, /Max-Age=2592000/i);
    const refreshed = await request("/api/admin/account/refresh-token", {
      method: "POST",
      cookie: refreshCookie,
    });
    const refreshedData = expectSuccess(refreshed);
    const refreshedAccessToken = validateToken(refreshedData.token);
    assert.ok(refreshedAccessToken && typeof refreshedAccessToken !== "string");
    assert.ok(refreshedAccessToken.iat && refreshedAccessToken.exp);
    assert.equal(refreshedAccessToken.exp - refreshedAccessToken.iat, 60 * 60);
    assert.match(refreshed.headers.get("set-cookie") ?? "", /Max-Age=2592000/i);
    assert.equal(registrationData.user.address, null);

    expectSuccess(
      await request("/api/admin/account/change-password", {
        method: "PUT",
        token: registrationData.token,
        body: {
          id: registrationData.user.id,
          oldPassword: "Password123!",
          newPassword: "NewPassword123!",
        },
      }),
    );
    const incorrectOldPassword = await request(
      "/api/admin/account/change-password",
      {
        method: "PUT",
        token: registrationData.token,
        body: {
          id: registrationData.user.id,
          oldPassword: "Password123!",
          newPassword: "AnotherPassword123!",
        },
      },
    );
    assert.equal(incorrectOldPassword.status, 401);
    const logout = await request("/api/admin/account/logout", {
      method: "POST",
      cookie: refreshCookie,
    });
    expectSuccess(logout);
    const clearedCookie = logout.headers.get("set-cookie") ?? "";
    assert.match(clearedCookie, /Expires=Thu, 01 Jan 1970 00:00:00 GMT/i);
    assert.match(clearedCookie, /Path=\//i);
    assert.match(clearedCookie, /SameSite=Strict/i);
    const [employee] = await db
      .insert(schema.accountTable)
      .values({
        email: `api-employee-${suffix}@example.test`,
        password: "not-used",
        realName: "API Test Employee",
        role: "employee",
        phone: "0900000003",
        accountGroupId: accountGroup.id,
      })
      .returning();
    await db
      .insert(schema.accountWalletTable)
      .values({ accountId: employee.id });
    const employeeToken = generateToken(employee)!;

    const createdSubAccount = expectSuccess(
      await request("/api/admin/account/sub-account", {
        method: "POST",
        token: sellerToken,
        body: {
          parentId: seller.id,
          name: "API Created Operator",
          realName: "測試員工",
          email: `api-created-employee-${suffix}@example.test`,
          password: "Password123!",
          phone: "0912345679",
        },
      }),
    );
    assert.equal(createdSubAccount.role, "employee");
    assert.equal(createdSubAccount.parent.id, seller.id);
    const createdSubWallet = await db.query.accountWalletTable.findFirst({
      where: eq(schema.accountWalletTable.accountId, createdSubAccount.id),
    });
    assert.equal(createdSubWallet?.walletBalance, "0.00");
    const createdSubReadStates = await db
      .select()
      .from(schema.adminSidebarReadStateTable)
      .where(
        eq(
          schema.adminSidebarReadStateTable.accountId,
          createdSubAccount.id,
        ),
      );
    assert.equal(createdSubReadStates.length, 5);
    const crossSellerSubAccount = await request(
      "/api/admin/account/sub-account",
      {
        method: "POST",
        token: sellerToken,
        body: {
          parentId: otherSeller.id,
          name: "Invalid Operator",
          realName: "測試員工",
          email: `api-invalid-employee-${suffix}@example.test`,
          password: "Password123!",
          phone: "0912345680",
        },
      },
    );
    assert.equal(crossSellerSubAccount.status, 403);
    const employeeCreatesEmployee = await request(
      "/api/admin/account/sub-account",
      {
        method: "POST",
        token: employeeToken,
        body: {
          name: "Invalid Operator",
          realName: "測試員工",
          email: `api-employee-created-${suffix}@example.test`,
          password: "Password123!",
          phone: "0912345681",
        },
      },
    );
    assert.equal(employeeCreatesEmployee.status, 403);
    const createdSubToken = generateToken(createdSubAccount)!;
    expectSuccess(
      await request(`/api/admin/account/${createdSubAccount.id}`, {
        method: "DELETE",
        token: sellerToken,
      }),
    );
    const deletedSubProfile = await request("/api/admin/account/me", {
      token: createdSubToken,
    });
    assert.equal(deletedSubProfile.status, 403);

    const sellerCategoryCreate = await request(
      "/api/admin/product/categories/create",
      { method: "POST", token: sellerToken, body: { name: `Seller ${suffix}` } },
    );
    assert.equal(sellerCategoryCreate.status, 403);
    const category = expectSuccess(
      await request("/api/admin/product/categories/create", {
        method: "POST",
        token: adminToken,
        body: { name: `API Category ${suffix}` },
      }),
    );
    const renamedCategory = expectSuccess(
      await request(`/api/admin/product/categories/${category.id}`, {
        method: "PUT",
        token: adminToken,
        body: { name: `API Renamed Category ${suffix}` },
      }),
    );
    assert.equal(renamedCategory.name, `API Renamed Category ${suffix}`);
    const spareCategory = expectSuccess(
      await request("/api/admin/product/categories/create", {
        method: "POST",
        token: adminToken,
        body: { name: `API Spare Category ${suffix}` },
      }),
    );
    const duplicateCategory = await request(
      `/api/admin/product/categories/${spareCategory.id}`,
      {
        method: "PUT",
        token: adminToken,
        body: { name: renamedCategory.name.toUpperCase() },
      },
    );
    assert.equal(duplicateCategory.status, 409);
    expectSuccess(
      await request(`/api/admin/product/categories/${spareCategory.id}`, {
        method: "DELETE",
        token: adminToken,
      }),
    );

    const avatarUrl = "https://example.test/avatar.png";
    const updatedSeller = expectSuccess(
      await request("/api/admin/account/update", {
        method: "PUT",
        token: sellerToken,
        body: { id: seller.id, avatarUrl },
      }),
    );
    assert.equal(updatedSeller.avatar_url, avatarUrl);
    const clearedSellerAvatar = expectSuccess(
      await request("/api/admin/account/update", {
        method: "PUT",
        token: sellerToken,
        body: { id: seller.id, avatar_url: null },
      }),
    );
    assert.equal(clearedSellerAvatar.avatar_url, null);

    const sellerAccountList = await request("/api/admin/account/list", {
      token: sellerToken,
    });
    assert.equal(sellerAccountList.status, 403);
    const groupAccountList = expectSuccess(
      await request(
        `/api/admin/account/list?sellerId=${seller.id}&accountGroupId=${accountGroup.id}`,
        { token: adminToken },
      ),
    );
    assert.equal(groupAccountList.accounts.length, 1);
    assert.equal(groupAccountList.accounts[0].id, employee.id);
    const parentAccountList = expectSuccess(
      await request(`/api/admin/account/list?parentId=${seller.id}`, {
        token: adminToken,
      }),
    );
    assert.equal(parentAccountList.accounts.length, 1);
    assert.equal(parentAccountList.accounts[0].id, employee.id);
    const conflictingParentFilters = await request(
      `/api/admin/account/list?sellerId=${seller.id}&parentId=${otherSeller.id}`,
      { token: adminToken },
    );
    assert.equal(conflictingParentFilters.status, 400);

    const feeSettings = expectSuccess(
      await request("/api/admin/delivery/helper/fee", {
        method: "POST",
        token: sellerToken,
        body: { homeDeliveryRefrig: 100 },
      }),
    );
    assert.equal(feeSettings.homeDeliveryRefrig, 100);

    const sellerCredit = expectSuccess(
      await request(`/api/admin/account-wallet/${seller.id}/credit`, {
        method: "POST",
        token: adminToken,
        body: {
          amount: "500.00",
          idempotencyKey: `api-wallet-credit-${suffix}`,
          reason: "Disposable API funding fixture",
        },
      }),
    );
    assert.equal(sellerCredit.wallet.walletBalance, "500.00");
    assert.equal(sellerCredit.transaction.type, "admin_credit");
    assert.equal(sellerCredit.transaction.balanceBefore, "0.00");
    assert.equal(sellerCredit.transaction.balanceAfter, "500.00");

    const replayedSellerCredit = expectSuccess(
      await request(`/api/admin/account-wallet/${seller.id}/credit`, {
        method: "POST",
        token: adminToken,
        body: {
          amount: 500,
          idempotencyKey: `api-wallet-credit-${suffix}`,
          reason: "This metadata does not change the financial payload",
        },
      }),
    );
    assert.equal(replayedSellerCredit.idempotentReplay, true);
    assert.equal(replayedSellerCredit.wallet.walletBalance, "500.00");

    const conflictingCredit = await request(
      `/api/admin/account-wallet/${seller.id}/credit`,
      {
        method: "POST",
        token: adminToken,
        body: {
          amount: "501.00",
          idempotencyKey: `api-wallet-credit-${suffix}`,
        },
      },
    );
    assert.equal(conflictingCredit.status, 409);
    const forbiddenSellerCredit = await request(
      `/api/admin/account-wallet/${seller.id}/credit`,
      {
        method: "POST",
        token: sellerToken,
        body: {
          amount: "1.00",
          idempotencyKey: `api-wallet-forbidden-${suffix}`,
        },
      },
    );
    assert.equal(forbiddenSellerCredit.status, 403);
    const nonSellerCredit = await request(
      `/api/admin/account-wallet/${employee.id}/credit`,
      {
        method: "POST",
        token: adminToken,
        body: {
          amount: "1.00",
          idempotencyKey: `api-wallet-nonseller-${suffix}`,
        },
      },
    );
    assert.equal(nonSellerCredit.status, 409);

    const products = await db
      .insert(schema.productTable)
      .values([0, 1].map((index) => ({
        sellerId: seller.id,
        name: `API Product ${suffix} ${index}`,
        description: "Disposable API test fixture",
      })))
      .returning();
    const variants = await db
      .insert(schema.productVariantTable)
      .values(products.map((product, index) => ({
        productId: product.id,
        name: "Default",
        sku: `api-${suffix}-${index}`,
        price: 20,
        stock: 100,
        optionValues: {},
      })))
      .returning();
    await db.insert(schema.productsToCategoriesTable).values({
      productId: products[0].id,
      categoryId: category.id,
    });
    const referencedCategoryDelete = expectSuccess(
      await request(`/api/admin/product/categories/${category.id}`, {
        method: "DELETE",
        token: adminToken,
      }),
    );
    assert.equal(referencedCategoryDelete.id, category.id);
    assert.equal(referencedCategoryDelete.deleted, true);
    assert.equal(referencedCategoryDelete.detachedProductCount, 1);
    const [preservedProduct] = await db
      .select({ id: schema.productTable.id })
      .from(schema.productTable)
      .where(eq(schema.productTable.id, products[0].id));
    assert.equal(preservedProduct.id, products[0].id);
    const remainingCategoryLinks = await db
      .select()
      .from(schema.productsToCategoriesTable)
      .where(eq(schema.productsToCategoriesTable.categoryId, category.id));
    assert.equal(remainingCategoryLinks.length, 0);
    const [deletedCategory] = await db
      .select({ id: schema.categoryTable.id })
      .from(schema.categoryTable)
      .where(eq(schema.categoryTable.id, category.id));
    assert.equal(deletedCategory, undefined);

    const employeeProducts = expectSuccess(
      await request("/api/admin/product/list?limit=100", {
        token: employeeToken,
      }),
    );
    assert.equal(employeeProducts.total, products.length);
    const employeeCrossSellerProducts = await request(
      `/api/admin/product/list?sellerId=${otherSeller.id}`,
      { token: employeeToken },
    );
    assert.equal(employeeCrossSellerProducts.status, 403);

    const disposableProduct = expectSuccess(
      await request("/api/admin/product/create", {
        method: "POST",
        token: sellerToken,
        body: {
          sellerId: seller.id,
          name: `Disposable Product ${suffix}`,
          description: "Never-used deletion fixture",
          variants: [
            { price: 10, stock: 1, optionValues: {} },
          ],
        },
      }),
    );
    const employeeProductDelete = await request(
      `/api/admin/product/${disposableProduct.id}`,
      { method: "DELETE", token: employeeToken },
    );
    assert.equal(employeeProductDelete.status, 403);
    const softDeletedProduct = expectSuccess(
      await request(`/api/admin/product/${disposableProduct.id}`, {
        method: "DELETE",
        token: sellerToken,
      }),
    );
    assert.equal(softDeletedProduct.status, "inactive");
    assert.ok(softDeletedProduct.deletedAt);
    expectSuccess(
      await request(`/api/admin/product/${disposableProduct.id}/permanent`, {
        method: "DELETE",
        token: adminToken,
      }),
    );

    expectSuccess(await request("/api/test"));
    const unauthenticatedProfile = await request("/api/auth/profile");
    assert.equal(unauthenticatedProfile.status, 401);
    assert.equal(unauthenticatedProfile.json.success, false);

    const advertisements: schema.Advertisement[] = [];
    for (const [index, product] of products.entries()) {
      const created = expectSuccess(
        await request("/api/admin/advertisement/create", {
          method: "POST",
          token: sellerToken,
          body: {
            productId: product.id,
            title: `API Ad ${suffix} ${index}`,
            video_url: "https://example.test/ad.mp4",
          },
        }),
      ) as schema.Advertisement;
      advertisements.push(created);
      const funding = expectSuccess(
        await request(`/api/admin/advertisement/deposit/${created.id}`, {
          method: "PUT",
          token: sellerToken,
          body: {
            amount: "200.00",
            idempotencyKey: `api-ad-funding-${suffix}-${index}`,
          },
        }),
      );
      assert.equal(funding.walletTransaction.amount, "-200.00");
      assert.equal(funding.advertisementTransaction.type, "wallet_funding");
      if (index === 0) {
        const replay = expectSuccess(
          await request(`/api/admin/advertisement/deposit/${created.id}`, {
            method: "PUT",
            token: sellerToken,
            body: {
              amount: 200,
              idempotencyKey: `api-ad-funding-${suffix}-${index}`,
            },
          }),
        );
        assert.equal(replay.idempotentReplay, true);
        assert.equal(replay.wallet.walletBalance, "300.00");
        const conflictingReplay = await request(
          `/api/admin/advertisement/deposit/${created.id}`,
          {
            method: "PUT",
            token: sellerToken,
            body: {
              amount: "201.00",
              idempotencyKey: `api-ad-funding-${suffix}-${index}`,
            },
          },
        );
        assert.equal(conflictingReplay.status, 409);
      }
      expectSuccess(
        await request(`/api/admin/advertisement/status/${created.id}`, {
          method: "PUT",
          token: sellerToken,
          body: { status: "active" },
        }),
      );
    }
    const referencedProductPermanentDelete = await request(
      `/api/admin/product/${products[0].id}/permanent`,
      { method: "DELETE", token: adminToken },
    );
    assert.equal(referencedProductPermanentDelete.status, 409);

    const sellerWallet = expectSuccess(
      await request("/api/admin/account-wallet/me", { token: sellerToken }),
    );
    assert.equal(sellerWallet.walletBalance, "100.00");
    const adminSellerWallet = expectSuccess(
      await request(`/api/admin/account-wallet/${seller.id}`, {
        token: adminToken,
      }),
    );
    assert.equal(adminSellerWallet.walletBalance, "100.00");
    const forbiddenWalletLookup = await request(
      `/api/admin/account-wallet/${otherSeller.id}`,
      { token: sellerToken },
    );
    assert.equal(forbiddenWalletLookup.status, 403);
    const walletTransactions = expectSuccess(
      await request("/api/admin/account-wallet/me/transactions?limit=20", {
        token: sellerToken,
      }),
    );
    assert.equal(walletTransactions.total, 3);
    const walletSummary = expectSuccess(
      await request("/api/admin/account-wallet/me/summary", {
        token: sellerToken,
      }),
    );
    assert.equal(walletSummary.openingBalance, "0.00");
    assert.equal(walletSummary.adminCredits, "500.00");
    assert.equal(walletSummary.advertisementFundingDebits, "-400.00");
    assert.equal(walletSummary.closingBalance, "100.00");

    const unsupportedBudgetDecrease = await request(
      `/api/admin/advertisement/budget/${advertisements[0].id}`,
      {
        method: "PUT",
        token: sellerToken,
        body: {
          operation: "decrease",
          amount: "1.00",
          idempotencyKey: `api-budget-decrease-${suffix}`,
        },
      },
    );
    assert.equal(unsupportedBudgetDecrease.status, 409);
    const crossSellerBudgetDecrease = await request(
      `/api/admin/advertisement/budget/${advertisements[0].id}`,
      {
        method: "PUT",
        token: otherSellerToken,
        body: {
          operation: "decrease",
          amount: "1.00",
          idempotencyKey: `api-budget-cross-seller-${suffix}`,
        },
      },
    );
    assert.equal(crossSellerBudgetDecrease.status, 403);
    const unsupportedBudgetSetLower = await request(
      `/api/admin/advertisement/budget/${advertisements[0].id}`,
      {
        method: "PUT",
        token: sellerToken,
        body: {
          operation: "set",
          amount: "199.00",
          idempotencyKey: `api-budget-lower-${suffix}`,
        },
      },
    );
    assert.equal(unsupportedBudgetSetLower.status, 409);
    const unchangedBudget = expectSuccess(
      await request(`/api/admin/advertisement/budget/${advertisements[0].id}`, {
        method: "PUT",
        token: sellerToken,
        body: {
          operation: "set",
          amount: "200.00",
          idempotencyKey: `api-budget-same-${suffix}`,
        },
      }),
    );
    assert.equal(unchangedBudget.noChange, true);

    const advertisementMetrics = expectSuccess(
      await request("/api/admin/advertisement/metrics?limit=100", {
        token: employeeToken,
      }),
    );
    assert.equal(advertisementMetrics.total, advertisements.length);
    const productAdDashboard = expectSuccess(
      await request(
        `/api/admin/advertisement/product/${products[0].id}/dashboard`,
        { token: employeeToken },
      ),
    );
    assert.equal(productAdDashboard.product.id, products[0].id);
    assert.equal(productAdDashboard.advertisements.length, 1);

    const dashboardKpi = expectSuccess(
      await request("/api/admin/dashboard/kpi", { token: employeeToken }),
    );
    assert.equal(dashboardKpi.sellerId, seller.id);
    assert.equal(dashboardKpi.walletBalance, "100.00");
    expectSuccess(
      await request(
        "/api/admin/dashboard/time-series?metric=adSpend&interval=day",
        { token: employeeToken },
      ),
    );
    expectSuccess(
      await request("/api/admin/dashboard/pending-tasks", {
        token: employeeToken,
      }),
    );
    const recentActivities = expectSuccess(
      await request("/api/admin/dashboard/recent-activities", {
        token: sellerToken,
      }),
    );
    assert.ok(recentActivities.activities.length > 0);

    const sidebarSummary = expectSuccess(
      await request("/api/admin/sidebar-notifications/summary", {
        token: employeeToken,
      }),
    );
    assert.equal(sidebarSummary.sellerId, seller.id);
    const firstSeen = expectSuccess(
      await request("/api/admin/sidebar-notifications/advertisements/seen", {
        method: "PUT",
        token: employeeToken,
        body: {},
      }),
    );
    const olderSeen = expectSuccess(
      await request("/api/admin/sidebar-notifications/advertisements/seen", {
        method: "PUT",
        token: employeeToken,
        body: { seenAt: new Date(0).toISOString() },
      }),
    );
    assert.equal(olderSeen.lastSeenAt, firstSeen.lastSeenAt);
    const insufficientFunding = await request(
      `/api/admin/advertisement/deposit/${advertisements[0].id}`,
      {
        method: "PUT",
        token: adminToken,
        body: {
          amount: "100.01",
          idempotencyKey: `api-ad-insufficient-${suffix}`,
        },
      },
    );
    assert.equal(insufficientFunding.status, 409);
    const forbiddenFunding = await request(
      `/api/admin/advertisement/deposit/${advertisements[0].id}`,
      {
        method: "PUT",
        token: otherSellerToken,
        body: {
          amount: "1.00",
          idempotencyKey: `api-ad-forbidden-${suffix}`,
        },
      },
    );
    assert.equal(forbiddenFunding.status, 403);

    const forbiddenStatusChange = await request(
      `/api/admin/advertisement/status/${advertisements[0].id}`,
      {
        method: "PUT",
        token: otherSellerToken,
        body: { status: "paused" },
      },
    );
    assert.equal(forbiddenStatusChange.status, 403);
    expectSuccess(
      await request(`/api/admin/advertisement/status/${advertisements[0].id}`, {
        method: "PUT",
        token: sellerToken,
        body: { status: "paused" },
      }),
    );
    await db
      .update(schema.productTable)
      .set({ status: "inactive" })
      .where(eq(schema.productTable.id, products[0].id));
    const inactiveProductActivation = await request(
      `/api/admin/advertisement/status/${advertisements[0].id}`,
      {
        method: "PUT",
        token: sellerToken,
        body: { status: "active" },
      },
    );
    assert.equal(inactiveProductActivation.status, 409);
    await db
      .update(schema.productTable)
      .set({ status: "active" })
      .where(eq(schema.productTable.id, products[0].id));
    await db
      .update(schema.productVariantTable)
      .set({ status: "inactive" })
      .where(eq(schema.productVariantTable.id, variants[0].id));
    const unavailableVariantActivation = await request(
      `/api/admin/advertisement/status/${advertisements[0].id}`,
      {
        method: "PUT",
        token: sellerToken,
        body: { status: "active" },
      },
    );
    assert.equal(unavailableVariantActivation.status, 409);
    await db
      .update(schema.productVariantTable)
      .set({ status: "active" })
      .where(eq(schema.productVariantTable.id, variants[0].id));
    expectSuccess(
      await request(`/api/admin/advertisement/status/${advertisements[0].id}`, {
        method: "PUT",
        token: adminToken,
        body: { status: "active" },
      }),
    );

    const forbiddenSingleViewCount = await request(
      `/api/admin/advertisement/${advertisements[0].id}/view-count`,
      { token: otherSellerToken },
    );
    assert.equal(forbiddenSingleViewCount.status, 403);
    expectSuccess(
      await request(
        `/api/admin/advertisement/${advertisements[0].id}/view-count`,
        { token: sellerToken },
      ),
    );
    const sellerPlatformViewCount = await request(
      "/api/admin/advertisement/platform/list/view-count",
      { token: sellerToken },
    );
    assert.equal(sellerPlatformViewCount.status, 403);
    const platformViewCount = expectSuccess(
      await request(
        `/api/admin/advertisement/platform/list/view-count?sellerId=${seller.id}`,
        { token: adminToken },
      ),
    );
    assert.equal(platformViewCount.total, advertisements.length);

    const user = await login(`reward-${suffix}`);
    const appAccessToken = validateToken(user.token);
    assert.ok(appAccessToken && typeof appAccessToken !== "string");
    assert.ok(appAccessToken.iat && appAccessToken.exp);
    assert.equal(appAccessToken.exp - appAccessToken.iat, 30 * 24 * 60 * 60);

    const sellerAppNotification = await request(
      "/api/admin/system/send-app-notification",
      {
        method: "POST",
        token: sellerToken,
        body: {
          userIds: [user.user.id],
          notification: { title: "Not allowed" },
        },
      },
    );
    assert.equal(sellerAppNotification.status, 403);
    const invalidAppNotification = await request(
      "/api/admin/system/send-app-notification",
      {
        method: "POST",
        token: adminToken,
        body: { notification: { title: "Missing target" } },
      },
    );
    assert.equal(invalidAppNotification.status, 400);
    const appNotification = expectSuccess(
      await request("/api/admin/system/send-app-notification", {
        method: "POST",
        token: adminToken,
        body: {
          userIds: [user.user.id],
          notification: { title: "API test" },
        },
      }),
    );
    assert.equal(appNotification.targetedUserCount, 1);
    assert.equal(appNotification.tokenCount, 0);
    const [appGroup] = await db
      .insert(schema.groupTable)
      .values({ ownerId: user.user.id })
      .returning();
    const groupNotification = expectSuccess(
      await request("/api/admin/system/send-app-notification", {
        method: "POST",
        token: adminToken,
        body: {
          groupIds: [appGroup.id],
          notification: { body: "Group API test" },
        },
      }),
    );
    assert.equal(groupNotification.targetedUserCount, 1);
    const profile = expectSuccess(
      await request("/api/auth/profile", { token: user.token }),
    ) as schema.User;
    assert.equal(profile.id, user.user.id);

    const validationFailure = await request(
      "/api/treasureBox/video-complete",
      {
        method: "POST",
        token: user.token,
        body: {},
      },
    );
    assert.equal(validationFailure.status, 400);

    const adList = expectSuccess(
      await request("/api/advertisement/list?limit=100", {
        token: user.token,
      }),
    );
    assert.ok(
      advertisements.every((advertisement) =>
        adList.advertisements.some(
          (listed: schema.Advertisement) => listed.id === advertisement.id,
        ),
      ),
    );

    expectSuccess(
      await request("/api/advertisement/list?limit=100", {
        token: user.token,
      }),
    );
    const reusedAssignments = await db
      .select()
      .from(schema.advertisementAssignmentTable)
      .where(
        and(
          eq(schema.advertisementAssignmentTable.userId, user.user.id),
          inArray(
            schema.advertisementAssignmentTable.advertisementId,
            advertisements.map((advertisement) => advertisement.id),
          ),
        ),
      );
    assert.equal(reusedAssignments.length, advertisements.length);

    const staleLocalDate = getLocalDate(
      new Date(Date.now() - 24 * 60 * 60 * 1_000),
      "Asia/Taipei",
    );
    const staleAssignedAt = new Date(Date.now() - 24 * 60 * 60 * 1_000);
    const [staleAssignment] = await db
      .insert(schema.advertisementAssignmentTable)
      .values({
        userId: user.user.id,
        advertisementId: advertisements[0].id,
        sourceSellerId: seller.id,
        assignmentBatchId: randomUUID(),
        userLocalDate: staleLocalDate,
        timezoneSnapshot: "Asia/Taipei",
        assignedAt: staleAssignedAt,
      })
      .returning();

    const firstCompletion = expectSuccess(
      await request("/api/treasureBox/video-complete", {
        method: "POST",
        token: user.token,
        body: { advertisementId: advertisements[0].id },
      }),
    );
    assert.equal(firstCompletion.isAwarded, false);
    const [stillIssuedStaleAssignment] = await db
      .select()
      .from(schema.advertisementAssignmentTable)
      .where(eq(schema.advertisementAssignmentTable.id, staleAssignment.id));
    assert.equal(stillIssuedStaleAssignment.status, "issued");
    const secondCompletion = expectSuccess(
      await request("/api/treasureBox/video-complete", {
        method: "POST",
        token: user.token,
        body: { advertisementId: advertisements[1].id },
      }),
    );
    assert.equal(secondCompletion.isAwarded, true);

    const duplicateCompletion = await request(
      "/api/treasureBox/video-complete",
      {
        method: "POST",
        token: user.token,
        body: { advertisementId: advertisements[1].id },
      },
    );
    assert.equal(duplicateCompletion.status, 409);

    const boxes = expectSuccess(
      await request("/api/treasureBox/list", { token: user.token }),
    ) as schema.TreasureBox[];
    assert.equal(boxes.length, 1);
    assert.equal(boxes[0].coinsAwarded, 15);
    expectSuccess(
      await request(`/api/treasureBox/open/${boxes[0].id}`, {
        method: "POST",
        token: user.token,
      }),
    );
    const duplicateOpen = await request(
      `/api/treasureBox/open/${boxes[0].id}`,
      { method: "POST", token: user.token },
    );
    assert.equal(duplicateOpen.status, 400);

    const rewardedProfile = expectSuccess(
      await request("/api/auth/profile", { token: user.token }),
    ) as schema.User;
    assert.equal(rewardedProfile.coins, 15);

    const ledger = expectSuccess(
      await request(
        `/api/admin/advertisement/${advertisements[0].id}/coin-ledger`,
        { token: sellerToken },
      ),
    );
    assert.equal(
      ledger.fundingAccount.advertisementId,
      advertisements[0].id,
    );
    const forbiddenLedger = await request(
      `/api/admin/advertisement/${advertisements[0].id}/coin-ledger`,
      { token: user.token },
    );
    assert.equal(forbiddenLedger.status, 403);

    const lateUser = await login(`expired-completion-${suffix}`);
    await db
      .update(schema.userDailyStatTable)
      .set({ groupAdViewsCountYesterday: 20 })
      .where(eq(schema.userDailyStatTable.userId, lateUser.user.id));
    expectSuccess(
      await request("/api/advertisement/list?limit=100", {
        token: lateUser.token,
      }),
    );
    const lateAssignments = await db
      .select()
      .from(schema.advertisementAssignmentTable)
      .where(
        and(
          eq(schema.advertisementAssignmentTable.userId, lateUser.user.id),
          inArray(
            schema.advertisementAssignmentTable.advertisementId,
            advertisements.map((advertisement) => advertisement.id),
          ),
        ),
      );
    assert.equal(lateAssignments.length, advertisements.length);
    await db
      .update(schema.advertisementAssignmentTable)
      .set({ status: "expired", userLocalDate: staleLocalDate })
      .where(
        inArray(
          schema.advertisementAssignmentTable.id,
          lateAssignments.map((assignment) => assignment.id),
        ),
      );
    const spendBeforeLateCompletion = await db
      .select({
        advertisementId: schema.advertisementStatsTable.advertisementId,
        balance: schema.advertisementStatsTable.balance,
        totalSpent: schema.advertisementStatsTable.totalSpent,
      })
      .from(schema.advertisementStatsTable)
      .where(
        inArray(
          schema.advertisementStatsTable.advertisementId,
          advertisements.map((advertisement) => advertisement.id),
        ),
      );

    const firstLateCompletion = await request(
      "/api/treasureBox/video-complete",
      {
        method: "POST",
        token: lateUser.token,
        body: { advertisementId: advertisements[0].id },
      },
    );
    assert.equal(firstLateCompletion.status, 409);
    const secondLateCompletion = await request(
      "/api/treasureBox/video-complete",
      {
        method: "POST",
        token: lateUser.token,
        body: { advertisementId: advertisements[1].id },
      },
    );
    assert.equal(secondLateCompletion.status, 409);
    const [unchangedLateDailyStat] = await db
      .select()
      .from(schema.userDailyStatTable)
      .where(eq(schema.userDailyStatTable.userId, lateUser.user.id));
    assert.equal(unchangedLateDailyStat.totalViews, 0);

    const spendAfterLateCompletion = await db
      .select({
        advertisementId: schema.advertisementStatsTable.advertisementId,
        balance: schema.advertisementStatsTable.balance,
        totalSpent: schema.advertisementStatsTable.totalSpent,
      })
      .from(schema.advertisementStatsTable)
      .where(
        inArray(
          schema.advertisementStatsTable.advertisementId,
          advertisements.map((advertisement) => advertisement.id),
        ),
      );
    assert.deepEqual(spendAfterLateCompletion, spendBeforeLateCompletion);
    const lateViews = await db
      .select()
      .from(schema.adViewCountTable)
      .where(
        inArray(
          schema.adViewCountTable.assignmentId,
          lateAssignments.map((assignment) => assignment.id),
        ),
      );
    assert.equal(lateViews.length, 0);
    const lateBoxes = expectSuccess(
      await request("/api/treasureBox/list", { token: lateUser.token }),
    ) as schema.TreasureBox[];
    assert.equal(lateBoxes.length, 0);

    const expiredBoxUser = await login(`expired-box-${suffix}`);
    const expiredDeadline = new Date(Date.now() - 1_000);
    const [expiredBox] = await db
      .insert(schema.treasureBoxTable)
      .values({
        userId: expiredBoxUser.user.id,
        coinsAwarded: 15,
        accountingStatus: "unacquired",
        isActive: false,
        timezoneSnapshot: "Asia/Taipei",
        userLocalDate: staleLocalDate,
        localClaimDeadlineAt: expiredDeadline,
        claimDeadlineAt: expiredDeadline,
      })
      .returning();
    const expiredBoxOpen = await request(
      `/api/treasureBox/open/${expiredBox.id}`,
      { method: "POST", token: expiredBoxUser.token },
    );
    assert.equal(expiredBoxOpen.status, 410);
    const [unchangedExpiredBoxUser] = await db
      .select()
      .from(schema.userTable)
      .where(eq(schema.userTable.id, expiredBoxUser.user.id));
    assert.equal(unchangedExpiredBoxUser.coins, 0);
    const [unchangedExpiredBox] = await db
      .select()
      .from(schema.treasureBoxTable)
      .where(eq(schema.treasureBoxTable.id, expiredBox.id));
    assert.equal(unchangedExpiredBox.isOpened, false);
    assert.equal(unchangedExpiredBox.accountingStatus, "unacquired");

    const graceUser = await login(`grace-${suffix}`);
    const graceList = expectSuccess(
      await request("/api/advertisement/list?limit=100", {
        token: graceUser.token,
      }),
    );
    assert.ok(
      graceList.advertisements.some(
        (listed: schema.Advertisement) => listed.id === advertisements[0].id,
      ),
    );
    expectSuccess(
      await request(
        `/api/admin/advertisement/status/${advertisements[0].id}`,
        {
          method: "PUT",
          token: sellerToken,
          body: { status: "archived" },
        },
      ),
    );

    const postArchiveUser = await login(`post-archive-${suffix}`);
    const postArchiveList = expectSuccess(
      await request("/api/advertisement/list?limit=100", {
        token: postArchiveUser.token,
      }),
    );
    assert.equal(
      postArchiveList.advertisements.some(
        (listed: schema.Advertisement) => listed.id === advertisements[0].id,
      ),
      false,
    );
    expectSuccess(
      await request("/api/treasureBox/video-complete", {
        method: "POST",
        token: graceUser.token,
        body: { advertisementId: advertisements[0].id },
      }),
    );

    const earlyClose = await request(
      `/api/admin/advertisement/${advertisements[0].id}/financial-close`,
      { method: "POST", token: sellerToken },
    );
    assert.equal(earlyClose.status, 409);

    await db
      .update(schema.advertisementTable)
      .set({ archiveGraceEndsAt: new Date(Date.now() - 1_000) })
      .where(eq(schema.advertisementTable.id, advertisements[0].id));
    expectSuccess(
      await request(
        `/api/admin/advertisement/${advertisements[0].id}/financial-close`,
        { method: "POST", token: sellerToken },
      ),
    );

    const replacement = expectSuccess(
      await request("/api/admin/advertisement/create", {
        method: "POST",
        token: sellerToken,
        body: {
          productId: products[0].id,
          title: `API Replacement ${suffix}`,
          video_url: "https://example.test/replacement.mp4",
        },
      }),
    ) as schema.Advertisement;
    assert.equal(
      replacement.replacementOfAdvertisementId,
      advertisements[0].id,
    );

    const idempotencyKey = `api-transfer-${suffix}`;
    const transferBody = {
      destinationAdvertisementId: replacement.id,
      amount: 1.25,
      idempotencyKey,
    };
    const firstTransfer = expectSuccess(
      await request(
        `/api/admin/advertisement/${advertisements[0].id}/balance-transfer`,
        { method: "POST", token: sellerToken, body: transferBody },
      ),
    );
    const repeatedTransfer = expectSuccess(
      await request(
        `/api/admin/advertisement/${advertisements[0].id}/balance-transfer`,
        { method: "POST", token: sellerToken, body: transferBody },
      ),
    );
    assert.equal(repeatedTransfer.id, firstTransfer.id);

    const orderUser = await login(`order-${suffix}`);
    const currentMonth = getLocalMonth(new Date(), "Asia/Taipei");
    const previousMonth = getLocalMonth(
      new Date(Date.now() - 32 * 24 * 60 * 60 * 1_000),
      "Asia/Taipei",
    );
    assert.notEqual(previousMonth, currentMonth);
    await db
      .update(schema.userTable)
      .set({ coins: 50 })
      .where(eq(schema.userTable.id, orderUser.user.id));
    await db.insert(schema.userMonthlyCoinStatTable).values([
      {
        userId: orderUser.user.id,
        month: previousMonth,
        coinsEarned: 2,
      },
      {
        userId: orderUser.user.id,
        month: currentMonth,
        coinsEarned: 48,
      },
    ]);
    await db.insert(schema.userCoinLotTable).values([
      {
        userId: orderUser.user.id,
        currentFunderType: "platform",
        legacySource: "api-test",
        originalAmount: "2.00",
        availableAmount: "2.00",
        timezoneSnapshot: "Asia/Taipei",
        earningLocalMonth: previousMonth,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000),
      },
      {
        userId: orderUser.user.id,
        currentFunderType: "platform",
        legacySource: "api-test",
        originalAmount: "48.00",
        availableAmount: "48.00",
        timezoneSnapshot: "Asia/Taipei",
        earningLocalMonth: currentMonth,
        expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1_000),
      },
    ]);

    const [virtualProduct] = await db
      .insert(schema.productTable)
      .values({
        sellerId: seller.id,
        name: `API Virtual Product ${suffix}`,
        description: "Virtual order/refund API fixture",
        type: "virtual",
      })
      .returning();
    const [virtualVariant] = await db
      .insert(schema.productVariantTable)
      .values({
        productId: virtualProduct.id,
        name: "Virtual",
        sku: `api-virtual-${suffix}`,
        price: 100,
        stock: 100,
        optionValues: {},
      })
      .returning();

    expectSuccess(
      await request("/api/collection", {
        method: "POST",
        token: orderUser.token,
        body: { productId: virtualProduct.id },
      }),
    );
    expectSuccess(
      await request("/api/cart/item", {
        method: "POST",
        token: orderUser.token,
        body: {
          productId: virtualProduct.id,
          productVariantId: virtualVariant.id,
          quantity: 1,
        },
      }),
    );
    expectSuccess(
      await request(`/api/admin/product/${virtualProduct.id}`, {
        method: "PUT",
        token: sellerToken,
        body: { status: "inactive" },
      }),
    );
    const cartAfterProductDeactivation = expectSuccess(
      await request("/api/cart/list", { token: orderUser.token }),
    ) as schema.CartItem[];
    assert.equal(
      cartAfterProductDeactivation.some(
        (item) => item.productId === virtualProduct.id,
      ),
      false,
    );
    const collectionsAfterProductDeactivation = expectSuccess(
      await request("/api/collection/list", { token: orderUser.token }),
    );
    assert.equal(
      collectionsAfterProductDeactivation.collections.some(
        (collection: schema.Collection) =>
          collection.productId === virtualProduct.id,
      ),
      false,
    );
    const [preservedInactiveCollection] = await db
      .select()
      .from(schema.collectionTable)
      .where(
        and(
          eq(schema.collectionTable.userId, orderUser.user.id),
          eq(schema.collectionTable.productId, virtualProduct.id),
        ),
      );
    assert.ok(preservedInactiveCollection);
    const addInactiveProductToCart = await request("/api/cart/item", {
      method: "POST",
      token: orderUser.token,
      body: {
        productId: virtualProduct.id,
        productVariantId: virtualVariant.id,
        quantity: 1,
      },
    });
    assert.equal(addInactiveProductToCart.status, 400);
    assert.match(
      String(addInactiveProductToCart.json.message),
      /Product is unavailable/,
    );
    const collectInactiveProduct = await request("/api/collection", {
      method: "POST",
      token: orderUser.token,
      body: { productId: virtualProduct.id },
    });
    assert.equal(collectInactiveProduct.status, 400);
    assert.match(
      String(collectInactiveProduct.json.message),
      /Product is unavailable/,
    );
    expectSuccess(
      await request(`/api/admin/product/${virtualProduct.id}`, {
        method: "PUT",
        token: sellerToken,
        body: { status: "active" },
      }),
    );
    const collectionsAfterProductReactivation = expectSuccess(
      await request("/api/collection/list", { token: orderUser.token }),
    );
    assert.equal(
      collectionsAfterProductReactivation.collections.some(
        (collection: schema.Collection) =>
          collection.productId === virtualProduct.id,
      ),
      true,
    );

    const [variantCartProduct] = await db
      .insert(schema.productTable)
      .values({
        sellerId: seller.id,
        name: `API Variant Cart Product ${suffix}`,
        description: "Cart cleanup API fixture",
        type: "virtual",
      })
      .returning();
    const variantCartVariants = await db
      .insert(schema.productVariantTable)
      .values(
        ["Small", "Medium", "Large"].map((name, index) => ({
          productId: variantCartProduct.id,
          name,
          sku: `api-cart-${index}-${suffix}`,
          price: 100 + index,
          stock: 10,
          sortOrder: index,
          optionValues: { size: name },
        })),
      )
      .returning();
    expectSuccess(
      await request("/api/collection", {
        method: "POST",
        token: orderUser.token,
        body: { productId: variantCartProduct.id },
      }),
    );
    for (const variant of variantCartVariants.slice(0, 2)) {
      expectSuccess(
        await request("/api/cart/item", {
          method: "POST",
          token: orderUser.token,
          body: {
            productId: variantCartProduct.id,
            productVariantId: variant.id,
            quantity: 1,
          },
        }),
      );
    }
    expectSuccess(
      await request(`/api/admin/product/${variantCartProduct.id}`, {
        method: "PUT",
        token: sellerToken,
        body: {
          variants: [{ id: variantCartVariants[0].id, status: "inactive" }],
        },
      }),
    );
    const cartAfterVariantDeactivation = expectSuccess(
      await request("/api/cart/list", { token: orderUser.token }),
    ) as schema.CartItem[];
    assert.equal(
      cartAfterVariantDeactivation.some(
        (item) => item.productVariantId === variantCartVariants[0].id,
      ),
      false,
    );
    assert.equal(
      cartAfterVariantDeactivation.some(
        (item) => item.productVariantId === variantCartVariants[1].id,
      ),
      true,
    );
    const collectionsAfterVariantDeactivation = expectSuccess(
      await request("/api/collection/list", { token: orderUser.token }),
    );
    assert.equal(
      collectionsAfterVariantDeactivation.collections.some(
        (collection: schema.Collection) =>
          collection.productId === variantCartProduct.id,
      ),
      true,
    );
    expectSuccess(
      await request(`/api/admin/product/${variantCartProduct.id}`, {
        method: "DELETE",
        token: sellerToken,
      }),
    );
    const cartAfterProductSoftDelete = expectSuccess(
      await request("/api/cart/list", { token: orderUser.token }),
    ) as schema.CartItem[];
    assert.equal(
      cartAfterProductSoftDelete.some(
        (item) => item.productId === variantCartProduct.id,
      ),
      false,
    );
    const [deletedProductCollection] = await db
      .select()
      .from(schema.collectionTable)
      .where(
        and(
          eq(schema.collectionTable.userId, orderUser.user.id),
          eq(schema.collectionTable.productId, variantCartProduct.id),
        ),
      );
    assert.equal(deletedProductCollection, undefined);

    const virtualOrderBody = (idempotencyKey: string) => ({
      idempotencyKey,
      items: [
        {
          productId: virtualProduct.id,
          productVariantId: virtualVariant.id,
          quantity: 1,
          unitPriceAtSale: 100,
          productNameAtSale: virtualProduct.name,
        },
      ],
      subTotal: 100,
      totalAmount: 95,
      discountCoin: 50,
      shippingCost: 0,
      shippingCostDeduction: 0,
      transactionFee: 0,
      orderPayment: "Credit",
    });

    await db
      .update(schema.productTable)
      .set({ status: "inactive" })
      .where(eq(schema.productTable.id, virtualProduct.id));
    const inactiveProductOrder = await request("/api/order", {
      method: "POST",
      token: orderUser.token,
      body: virtualOrderBody(`api-order-inactive-product-${suffix}`),
    });
    assert.equal(inactiveProductOrder.status, 400);
    assert.match(
      String(inactiveProductOrder.json.message),
      /Product inactive/,
    );

    await db
      .update(schema.productTable)
      .set({ status: "active", deletedAt: new Date() })
      .where(eq(schema.productTable.id, virtualProduct.id));
    const deletedProductOrder = await request("/api/order", {
      method: "POST",
      token: orderUser.token,
      body: virtualOrderBody(`api-order-deleted-product-${suffix}`),
    });
    assert.equal(deletedProductOrder.status, 400);
    assert.match(
      String(deletedProductOrder.json.message),
      /Product deleted/,
    );

    await db
      .update(schema.productTable)
      .set({ deletedAt: null })
      .where(eq(schema.productTable.id, virtualProduct.id));
    const orderIdempotencyKey = `api-order-${suffix}`;
    const order = expectSuccess(
      await request("/api/order", {
        method: "POST",
        token: orderUser.token,
        body: virtualOrderBody(orderIdempotencyKey),
      }),
    );
    assert.equal(order.orderStatus, "pending");
    assert.equal(order.coinInfo, null);

    const callbackData = {
      MerchantID: process.env.MERCHANTID!,
      MerchantTradeNo: `API${Date.now()}`,
      RtnCode: "1",
      RtnMsg: "Succeeded",
      TradeAmt: "95",
      TradeNo: `MOCK${Date.now()}`,
      PaymentDate: "2026/09/12 12:00:00",
      PaymentType: "Credit_CreditCard",
      PaymentTypeChargeFee: "0",
      TradeDate: "2026/09/12 11:59:00",
      SimulatePaid: "0",
      CustomField1: order.id,
      CustomField2: orderIdempotencyKey,
      CustomField3: "",
      CustomField4: "",
    };
    const checkMacValue = ecpayService.generateCheckValue(
      callbackData,
      process.env.HASHKEY!,
      process.env.HASHIV!,
    );
    const callbackResponse = await fetch(`${baseUrl}/api/ecpay/return`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        ...callbackData,
        CheckMacValue: checkMacValue,
      }),
    });
    assert.equal(callbackResponse.status, 200);
    assert.equal(await callbackResponse.text(), "1|OK");

    const paidOrder = expectSuccess(
      await request(`/api/order/${order.id}`, { token: orderUser.token }),
    );
    assert.equal(paidOrder.orderStatus, "paid");
    assert.deepEqual(paidOrder.coinInfo, {
      [previousMonth]: 2,
      [currentMonth]: 48,
    });
    const paidUser = expectSuccess(
      await request("/api/auth/profile", { token: orderUser.token }),
    ) as schema.User;
    assert.equal(paidUser.coins, 0);

    const [virtualDelivery] = await db
      .insert(schema.deliveryTable)
      .values({
        orderId: order.id,
        status: "delivered",
        LogisticsType: "virtual",
        GoodsAmount: 100,
      })
      .returning();
    await db
      .update(schema.orderItemTable)
      .set({ deliveryId: virtualDelivery.id })
      .where(eq(schema.orderItemTable.id, order.items[0].id));

    const refund = expectSuccess(
      await request("/api/refund", {
        method: "POST",
        token: orderUser.token,
        body: {
          orderItemId: order.items[0].id,
          accountId: seller.id,
          quantity: 1,
          refundAmount: 99.5,
          extraRefundAmount: 0.72,
          reason: "API refund coin restoration test",
        },
      }),
    );
    assert.equal(refund.paidRefundAmount, 94.53);
    assert.equal(refund.cashRefundAmount, 95);
    assert.equal(refund.cashRemainderCoins, 2.5);
    await waitFor(async () => {
      const chatRoom = await db.query.chatRoomTable.findFirst({
        where: eq(schema.chatRoomTable.orderId, order.id),
        with: { messages: true },
      });
      return Boolean(chatRoom?.messages.length);
    }, "refund chat message");
    const refundChatRoom = await db.query.chatRoomTable.findFirst({
      where: eq(schema.chatRoomTable.orderId, order.id),
      with: { messages: true },
    });
    const refundMessages = refundChatRoom?.messages ?? [];
    const refundChatContent =
      refundMessages[refundMessages.length - 1]?.content ?? "";
    assert.match(refundChatContent, /退款金額：NT\$ 95/);
    assert.match(refundChatContent, /退還金幣：52\.25/);
    assert.match(
      refundChatContent,
      /退款金額的小數部分將依 NT\$1 = 10 金幣轉換/,
    );
    assert.doesNotMatch(refundChatContent, /原始現金退款|實際現金退款/);
    const completedRefund = expectSuccess(
      await request(`/api/admin/refund/${refund.id}/status`, {
        method: "PATCH",
        token: sellerToken,
        body: {
          status: "completed",
          message: "API test refund completed",
        },
      }),
    );
    assert.equal(completedRefund.paidRefundAmount, 94.53);
    assert.equal(completedRefund.extraRefundAmount, 0.72);
    assert.equal(completedRefund.cashRefundAmount, 95);
    assert.equal(completedRefund.cashRemainderCoins, 2.5);
    assert.equal(completedRefund.coins, 49.75);
    assert.equal(completedRefund.returnableCoins, 52.25);
    assert.equal(completedRefund.summary.originalReturnableCoin, 49.75);
    assert.equal(completedRefund.summary.cashRemainderCoin, 2.5);
    assert.equal(
      completedRefund.summary.cashRemainderSourceSellerId,
      seller.id,
    );
    assert.deepEqual(completedRefund.summary.coinByMonth, {
      [previousMonth]: { coin: 2, expired: false, returnedCoin: 2 },
      [currentMonth]: { coin: 47.75, expired: false, returnedCoin: 47.75 },
    });
    const terminalExtraUpdate = await request(
      `/api/admin/refund/${refund.id}/status`,
      {
        method: "PATCH",
        token: sellerToken,
        body: { extraRefundAmount: 1 },
      },
    );
    assert.equal(terminalExtraUpdate.status, 400);
    const [conversionLot] = await db
      .select()
      .from(schema.userCoinLotTable)
      .where(eq(schema.userCoinLotTable.sourceRefundId, refund.id));
    assert.ok(conversionLot);
    assert.equal(conversionLot.sourceSellerId, seller.id);
    assert.equal(conversionLot.originalAmount, "2.50");
    const [conversionTransaction] = await db
      .select()
      .from(schema.userCoinTransactionTable)
      .where(eq(schema.userCoinTransactionTable.lotId, conversionLot.id));
    assert.equal(conversionTransaction.type, "cash_refund_conversion");
    const refundedUser = expectSuccess(
      await request("/api/auth/profile", { token: orderUser.token }),
    ) as schema.User;
    assert.equal(refundedUser.coins, 52.25);

    await db
      .update(schema.userCoinLotTable)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(schema.userCoinLotTable.id, conversionLot.id));
    const expiredConversionLots = await expireUserCoinLots();
    assert.ok(expiredConversionLots.includes(conversionLot.id));
    const [sellerReturn] = await db
      .select()
      .from(schema.productSellerCoinReturnTransactionTable)
      .where(
        eq(
          schema.productSellerCoinReturnTransactionTable.userCoinLotId,
          conversionLot.id,
        ),
      );
    assert.equal(sellerReturn.sourceSellerId, seller.id);
    assert.equal(sellerReturn.reason, "expired_unused");
    assert.equal(sellerReturn.coinAmount, "2.50");
    const userAfterConversionExpiry = expectSuccess(
      await request("/api/auth/profile", { token: orderUser.token }),
    ) as schema.User;
    assert.equal(userAfterConversionExpiry.coins, 49.75);

    console.log("API end-to-end tests passed");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await client.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

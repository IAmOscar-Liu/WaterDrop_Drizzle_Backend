import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import { CustomError } from "../lib/error";
import db from "../lib/initDB";

export type AdminSellerScope = {
  accountId: string;
  role: schema.Account["role"];
  sellerId?: string;
  isPlatformAdmin: boolean;
};

export async function getActiveAdminAccount(accountId: string) {
  const account = await db.query.accountTable.findFirst({
    where: eq(schema.accountTable.id, accountId),
    with: { group: { with: { parent: true } } },
  });

  if (!account || account.status !== "active" || account.deletedAt) {
    throw new CustomError("Account is inactive or no longer available", 403);
  }
  return account;
}

/** Resolve the business seller scope without trusting a seller-supplied ID. */
export async function resolveAdminSellerScope(
  accountId: string,
  requestedSellerId?: string,
): Promise<AdminSellerScope> {
  const account = await getActiveAdminAccount(accountId);

  if (account.role === "admin") {
    if (requestedSellerId) {
      const seller = await getActiveAdminAccount(requestedSellerId);
      if (seller.role !== "seller") {
        throw new CustomError("sellerId must identify an active seller", 400);
      }
    }
    return {
      accountId,
      role: account.role,
      sellerId: requestedSellerId,
      isPlatformAdmin: true,
    };
  }

  if (account.role === "seller") {
    if (requestedSellerId && requestedSellerId !== account.id) {
      throw new CustomError("You cannot access another seller's data", 403);
    }
    return {
      accountId,
      role: account.role,
      sellerId: account.id,
      isPlatformAdmin: false,
    };
  }

  const parent = account.group?.parent;
  if (
    !parent ||
    parent.role !== "seller" ||
    parent.status !== "active" ||
    parent.deletedAt
  ) {
    throw new CustomError("Employee is not assigned to an active seller", 403);
  }
  if (requestedSellerId && requestedSellerId !== parent.id) {
    throw new CustomError("You cannot access another seller's data", 403);
  }

  return {
    accountId,
    role: account.role,
    sellerId: parent.id,
    isPlatformAdmin: false,
  };
}

export async function requireNonEmployee(accountId: string) {
  const account = await getActiveAdminAccount(accountId);
  if (account.role === "employee") {
    throw new CustomError("Employees cannot perform this operation", 403);
  }
  return account;
}


import bcrypt from "bcrypt";
import { and, count, eq, ilike, or, SQL } from "drizzle-orm";
import * as schema from "../db/schema";
import { CustomError } from "../lib/error";
import db from "../lib/initDB";

// Admin account password: test1234

/**
 * Creates a new account (seller or admin).
 * @param accountData The data for the new account.
 * @returns The newly created account.
 */
export async function createAccount(
  accountData: schema.NewAccount
): Promise<Omit<schema.Account, "password">> {
  // In a real app, you would hash the password here.
  // For example, using bcrypt:
  const hashedPassword = await bcrypt.hash(accountData.password, 10);
  const dataToInsert = { ...accountData, password: hashedPassword };

  const [newAccount] = await db
    .insert(schema.accountTable)
    .values(dataToInsert)
    .returning();
  console.log("New account created:", newAccount.id);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { password, ...accountInfo } = newAccount;
  return accountInfo;
}

/**
 * Retrieves an account by email and verifies the password.
 * @param email The account's email.
 * @param password The account's plain-text password.
 * @returns The account object without the password hash if credentials are valid.
 * @throws {CustomError} If the email is not found or the password does not match.
 */
export async function getAccountByEmailAndPassword(
  email: string,
  password: string
): Promise<Omit<schema.Account, "password">> {
  const [account] = await db
    .select()
    .from(schema.accountTable)
    .where(eq(schema.accountTable.email, email));

  console.log("email find");

  if (!account) {
    throw new CustomError("Invalid email or password", 404);
  }

  const isPasswordValid = await bcrypt.compare(password, account.password);

  if (!isPasswordValid) {
    throw new CustomError("Invalid email or password", 404);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { password: _, ...accountInfo } = account;
  return accountInfo;
}

export async function getAccountById(
  accountId: string
): Promise<Omit<schema.Account, "password">> {
  const [account] = await db
    .select()
    .from(schema.accountTable)
    .where(eq(schema.accountTable.id, accountId));

  if (!account) {
    throw new CustomError("Account not found", 404);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { password: _, ...accountInfo } = account;
  return accountInfo;
}

export async function isAccountAdmin(accountId: string): Promise<boolean> {
  const [account] = await db
    .select()
    .from(schema.accountTable)
    .where(eq(schema.accountTable.id, accountId));

  if (!account) return false;

  return account.role === "admin";
}

/**
 * Updates an account's profile information (excluding password).
 * @param accountId The ID of the account to update.
 * @param updates The fields to update.
 * @returns The updated account object.
 * @throws {CustomError} If the account is not found.
 */
export async function updateAccount(
  accountId: string,
  updates: Partial<
    Omit<schema.Account, "id" | "password" | "createdAt" | "updatedAt">
  >
): Promise<Omit<schema.Account, "password">> {
  const [updatedAccount] = await db
    .update(schema.accountTable)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(schema.accountTable.id, accountId))
    .returning();

  if (!updatedAccount) {
    throw new CustomError("Account not found", 404);
  }

  console.log("Account updated:", updatedAccount.id);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { password, ...accountInfo } = updatedAccount;
  return accountInfo;
}

/**
 * Updates an account's password.
 * @param accountId The ID of the account to update.
 * @param oldPassword The current plain-text password for verification.
 * @param newPassword The new plain-text password.
 * @returns The updated account object.
 * @throws {CustomError} If the account is not found.
 */
export async function changeAccountPassword(
  accountId: string,
  oldPassword: string,
  newPassword: string
): Promise<Omit<schema.Account, "password">> {
  const [account] = await db
    .select()
    .from(schema.accountTable)
    .where(eq(schema.accountTable.id, accountId));

  if (!account) {
    throw new CustomError("Account not found", 404);
  }

  const isOldPasswordValid = await bcrypt.compare(
    oldPassword,
    account.password
  );
  if (!isOldPasswordValid) {
    throw new CustomError("Incorrect old password", 404);
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10);
  const [updatedAccount] = await db
    .update(schema.accountTable)
    .set({ password: hashedPassword, updatedAt: new Date() })
    .where(eq(schema.accountTable.id, accountId))
    .returning();

  if (!updatedAccount) throw new CustomError("Account not found", 404);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { password, ...accountInfo } = updatedAccount;
  return accountInfo;
}

export interface ListAccountsParams {
  page?: number;
  limit?: number;
  search?: string;
  role?: schema.NewAccount["role"];
  status?: schema.NewAccount["status"];
}

export async function listAccounts({
  page = 1,
  limit = 10,
  search,
  role,
  status,
}: ListAccountsParams) {
  const offset = (page - 1) * limit;
  const conditions: (SQL | undefined)[] = [];

  if (search) {
    conditions.push(
      or(
        ilike(schema.accountTable.email, `%${search}%`),
        ilike(schema.accountTable.name, `%${search}%`)
      )
    );
  }

  if (role) {
    conditions.push(eq(schema.accountTable.role, role));
  }

  if (status) {
    conditions.push(eq(schema.accountTable.status, status));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Query for total count matching the filters
  const totalResult = await db
    .select({ total: count() })
    .from(schema.accountTable)
    .where(whereClause);

  const total = totalResult[0].total;
  const totalPages = Math.ceil(total / limit);

  // Query for the paginated accounts
  const accountsWithPassword = await db
    .select()
    .from(schema.accountTable)
    .where(whereClause)
    .limit(limit)
    .offset(offset);

  const accounts = accountsWithPassword.map(
    ({ password, ...accountInfo }) => accountInfo
  );

  return { accounts, total, page, limit, totalPages };
}

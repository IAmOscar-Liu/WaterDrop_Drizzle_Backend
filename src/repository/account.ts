import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";
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

/**
 * Updates an account's profile information (excluding password).
 * @param accountId The ID of the account to update.
 * @param updates The fields to update.
 * @returns The updated account object.
 * @throws {CustomError} If the account is not found.
 */
export async function updateAccount(
  accountId: string,
  updates: Partial<Omit<schema.Account, "id" | "password" | "createdAt">>
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

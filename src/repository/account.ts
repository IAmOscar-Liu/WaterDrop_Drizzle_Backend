import bcrypt from "bcrypt";
import * as schema from "../db/schema";
import db from "../lib/initDB";

/**
 * Creates a new account (seller or admin).
 * NOTE: In a real application, you should hash the password before storing it.
 * @param accountData The data for the new account.
 * @returns The newly created account.
 */
export async function createAccount(accountData: schema.NewAccount) {
  // In a real app, you would hash the password here.
  // For example, using bcrypt:
  const hashedPassword = await bcrypt.hash(accountData.password, 10);
  const dataToInsert = { ...accountData, password: hashedPassword };

  const [newAccount] = await db
    .insert(schema.accountTable)
    .values(dataToInsert)
    .returning();
  console.log("New account created:", newAccount.id);
  return newAccount;
}

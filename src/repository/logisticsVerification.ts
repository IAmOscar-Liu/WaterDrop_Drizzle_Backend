import { eq } from "drizzle-orm";
import db from "../lib/initDB";
import { userTable } from "../db/schema";
import { CustomError } from "../lib/error";

export async function requireLogisticsVerificationUser(userId: string) {
  const user = await db.query.userTable.findFirst({
    columns: { id: true }, where: eq(userTable.id, userId),
  });
  if (!user) throw new CustomError("App user required", 401);
}

import * as schema from "../db/schema";
import db from "../lib/initDB";

export type AdminActivityInput = Omit<
  schema.NewAdminActivityEvent,
  "id" | "createdAt"
>;

export async function recordAdminActivity(input: AdminActivityInput) {
  const [event] = await db
    .insert(schema.adminActivityEventTable)
    .values(input)
    .returning();
  return event;
}

export async function recordAdminActivityWithTx(
  tx: any,
  input: AdminActivityInput,
) {
  const [event] = await tx
    .insert(schema.adminActivityEventTable)
    .values(input)
    .returning();
  return event;
}

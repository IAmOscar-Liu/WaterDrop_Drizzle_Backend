import "../lib/env";
import { runCoinExpiryNotificationJob } from "../lib/coinExpiryNotificationJob";

import dotenv from "dotenv";
import path from "path";
import { eq, sql } from "drizzle-orm";
import {
  setMonthlyCoinExpire,
  updateGroupAdViewsCountYesterday,
} from "../repository/user";
import bcrypt from "bcrypt";
import db from "../lib/initDB";
import * as schema from "../db/schema";
import { resetDailyStats } from "../repository/treasureBox";
import { CustomError } from "../lib/error";

// export async function testScript() {
//   console.log(await getUserById("e9b24ffc-7bc4-4c74-ab4a-d7983e20b314"));
// }

export async function testScript1() {
  // Match the production eligibility, local delivery time, and both channels.
  return runCoinExpiryNotificationJob();
}

// async function testScript2() {
//   setMonthlyCoinExpire(
//     [
//       "ad12924f-6c9e-4eb4-a545-062e6fafeec5",
//       "e8e3dfa4-ac9b-4029-941e-81c020f289d8",
//     ],
//     "2025-10",
//   );
// }

async function generateHashPassword(password: string) {
  const hashedPassword = await bcrypt.hash(password, 10);
  console.log(`Hashed password: ${hashedPassword}`);
}

async function testScript3() {
  const orders = await db.query.orderTable.findMany({
    where: eq(schema.orderTable.orderStatus, "paid"),
    with: {
      deliveries: true,
      items: true,
    },
  });

  const ordersWithDelivery = orders.filter((o) => o.deliveries.length > 0);

  for (const order of ordersWithDelivery) {
    const deliveryId = order.deliveries[0].id;
    for (const item of order.items) {
      await db
        .update(schema.orderItemTable)
        .set({ deliveryId })
        .where(eq(schema.orderItemTable.id, item.id));
    }
  }
}

async function calculateOrderSubTotal() {
  await db.update(schema.orderTable).set({
    subTotal: sql`${schema.orderTable.totalAmount} + COALESCE(${schema.orderTable.discountCoin}, 0) / 10.0`,
  });
  console.log("calculateOrderSubTotal done");
}

testScript1();
// generateHashPassword("test1234");
// testScript();
// testScript3();

// calculateOrderSubTotal();

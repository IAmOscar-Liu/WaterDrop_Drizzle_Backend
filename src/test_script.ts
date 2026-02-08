import dotenv from "dotenv";
import path from "path";
import { eq } from "drizzle-orm";
import { createNotification } from "./repository/notification";
import {
  getFcmTokensInUserIds,
  getUserIdsInTimezones,
  getUserMonthlyCoinStatsInUserIds,
  setMonthlyCoinExpire,
} from "./repository/user";
import { getCurrentLocalDateTime, getLastMonthYYYYMM } from "./lib/general";
import { sendMulticastPushNotification } from "./lib/sendNotification";
import bcrypt from "bcrypt";
import db from "./lib/initDB";
import * as schema from "./db/schema";

const env = process.env.NODE_ENV;
dotenv.config({
  path: path.resolve(process.cwd(), env ? `.env.${env}` : ".env"),
});

const FCM_MAX_BATCH_SIZE = 100; // Process 100 users at a time. Adjust as needed.
const RESET_BATCH_SIZE = 100;

// export async function testScript() {
//   console.log(await getUserById("e9b24ffc-7bc4-4c74-ab4a-d7983e20b314"));
// }

// export async function testScript1() {
//   let userIds = await getUserIdsInTimezones(["Asia/Taipei"]);

//   if (userIds.length === 0) {
//     console.log("No users found in the targeted timezones.");
//     return;
//   }

//   const yearMonthString = getLastMonthYYYYMM("Asia/Taipei"); // yyyy-mm

//   const userMonthlyCoinStats = (
//     await getUserMonthlyCoinStatsInUserIds(userIds, yearMonthString)
//   ).filter((stat) => stat.coinsEarned > stat.coinsSpent);
//   console.log(userMonthlyCoinStats);

//   const { localMonth, localYear } = getCurrentLocalDateTime("Asia/Taipei");
//   const lastMonth = localMonth === 1 ? 12 : localMonth - 1;
//   const nextMonth = localMonth === 12 ? 1 : localMonth + 1;
//   const nextYear = localMonth === 12 ? localYear + 1 : localYear;

//   for (let i = 0; i < userMonthlyCoinStats.length; i += RESET_BATCH_SIZE) {
//     const batchCoinStats = userMonthlyCoinStats.slice(i, i + RESET_BATCH_SIZE);

//     await Promise.allSettled(
//       batchCoinStats.map((stat) =>
//         createNotification({
//           userId: stat.userId,
//           type: "system_alert",
//           title: "金幣即將過期通知",
//           body: `您${lastMonth}月份的金幣尚有${
//             stat.coinsEarned - stat.coinsSpent
//           }未使用，即將在 ${nextYear}/${nextMonth
//             .toString()
//             .padStart(2, "0")}/01 00:00 過期，快把握時間使用您的金幣吧!`,
//         }),
//       ),
//     );
//   }

//   userIds = userMonthlyCoinStats.map((stats) => stats.userId);

//   const fcmTokens = await getFcmTokensInUserIds(userIds);
//   for (let i = 0; i < fcmTokens.length; i += FCM_MAX_BATCH_SIZE) {
//     const batchFcmTokens = fcmTokens.slice(i, i + FCM_MAX_BATCH_SIZE);

//     await sendMulticastPushNotification({
//       tokens: batchFcmTokens,
//       notification: {
//         title: "金幣即將過期通知",
//         body: `您${lastMonth}月份的金幣即將在 ${nextYear}/${nextMonth
//           .toString()
//           .padStart(2, "0")}/01 00:00 過期，快把握時間使用您的金幣吧!`,
//       },
//       data: {
//         command: "message",
//       },
//     });

//     console.log(`Total tokens processed: ${i + batchFcmTokens.length}`);
//   }
// }

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

// generateHashPassword("test1234");
// testScript();
testScript3();

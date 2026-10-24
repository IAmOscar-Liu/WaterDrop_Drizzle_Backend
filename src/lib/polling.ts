import { and, eq, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import * as schema from "../db/schema";
import { Delivery } from "../db/schema";
import {
  getDeliveryById,
  updateDeliveryWithNotificationContext,
} from "../repository/delivery";
import { createNotification } from "../repository/notification";
import { getFcmTokensInUserIds } from "../repository/user";
import ecpayService from "../services/ecpay";
import db from "./initDB";
import { isAwaitingPickup, isConfirmedReceipt } from "./refundEligibility";
import { sendMulticastPushNotification } from "./sendNotification";

export function isCVSReadyForPickup(
  logisticsType: Delivery["LogisticsType"],
  logisticsSubType?: string | null,
  rtnCode?: string | null,
) {
  return isAwaitingPickup({ LogisticsType: logisticsType, LogisticsSubType: logisticsSubType ?? null, RtnCode: rtnCode ?? null });
}

function hasCVSPickedUp(
  logisticsType: Delivery["LogisticsType"],
  logisticsSubType?: string | null,
  rtnCode?: string | null,
) {
  return logisticsType === "CVS" && isConfirmedReceipt({ status: "delivered", LogisticsType: logisticsType, LogisticsSubType: logisticsSubType ?? null, RtnCode: rtnCode ?? null });
}

function generateNotificationBody({
  status,
  readyForCVSPickup,
  CVSPickedUp,
  productNames,
  merchantTradeNo,
}: {
  status:
    | "shipped"
    | "ready_for_pickup"
    | "delivered"
    | "returned"
    | "exception";
  readyForCVSPickup: boolean;
  CVSPickedUp: boolean;
  productNames: string[];
  merchantTradeNo: string;
}) {
  const formattedProductNames = productNames.map((p) => `「${p}」`).join("、");

  if (readyForCVSPickup)
    return `您所購買的商品${formattedProductNames}已配送至指定門市。(訂單編號: ${merchantTradeNo})`;
  if (CVSPickedUp)
    return `您所購買的商品${formattedProductNames}已領取成功。(訂單編號: ${merchantTradeNo})`;
  if (status === "shipped")
    return `您所購買的商品${formattedProductNames}已出貨。(訂單編號: ${merchantTradeNo})`;
  if (status === "delivered")
    return `您所購買的商品${formattedProductNames}已送達。(訂單編號: ${merchantTradeNo})`;
  if (status === "exception")
    return `您所購買的商品${formattedProductNames}發生異常，請洽客服人員。(訂單編號: ${merchantTradeNo})`;
  if (status === "returned")
    return `您所購買的商品${formattedProductNames}已退回。(訂單編號: ${merchantTradeNo})`;
  return "";
}

export async function sendDeliveryNotification({
  lastStatus,
  update,
  delivery,
}: {
  lastStatus?: Delivery["status"];
  update: {
    status?: Delivery["status"];
    RtnCode?: string | null;
    RtnMsg?: string | null;
  };
  delivery: Awaited<ReturnType<typeof getDeliveryById>>;
}) {
  if (!lastStatus || !delivery?.order) return;
  if (
    !update.status ||
    update.status === "pending" ||
    update.status === "cancelled" ||
    update.status === "unknown"
  )
    return;

  const readyForCVSPickup =
    update.status === "ready_for_pickup"
      ? true
      : update.status === "delivered" &&
        isCVSReadyForPickup(
          delivery.LogisticsType,
          delivery.LogisticsSubType,
          delivery.RtnCode,
        );
  const CVSPickedUp =
    update.status === "delivered" &&
    hasCVSPickedUp(
      delivery.LogisticsType,
      delivery.LogisticsSubType,
      delivery.RtnCode,
    );

  if (!readyForCVSPickup && !CVSPickedUp && lastStatus === update.status)
    return;

  const userId = delivery.order.userId;
  const orderId = delivery.orderId;
  const fcmTokens = await getFcmTokensInUserIds([userId]);

  const productNames = delivery.items.map((item) => {
    const variantName = item.variantAtSale.name?.trim();
    return variantName
      ? `${item.productNameAtSale}（${variantName}）`
      : item.productNameAtSale;
  });

  const notificationBody = generateNotificationBody({
    status: update.status,
    readyForCVSPickup,
    CVSPickedUp,
    productNames,
    merchantTradeNo: delivery.order.merchantTradeNo || "",
  });

  const savedNotification = await createNotification({
    userId,
    type: "order_status",
    title: "運單狀態更新通知",
    body: `${notificationBody}\n如有任何問題，請聯繫客服人員。`,
    orderId,
    metadata: {
      clickAction: "view_order_details",
    },
  });

  await Promise.all([
    sendMulticastPushNotification({
      tokens: fcmTokens,
      notification: {
        title: "運單狀態更新通知",
        body: notificationBody,
      },
      data: {
        notificationId: savedNotification.id,
        command: "delivery_updated",
        orderId,
      },
    }, userId),
  ]);
}

export async function pollEcPayLogisticsTradeInfo() {
  if (
    process.env.NODE_ENV === "local" ||
    process.env.NODE_ENV === "development"
  )
    return;

  const fn = async (delivery: Delivery) => {
    try {
      if (!delivery.merchantTradeNo || !delivery.AllPayLogisticsID) return;
      const logisticsTradeInfo = await ecpayService.queryLogisticsTradeInfo({
        AllPayLogisticsID: delivery.AllPayLogisticsID,
        MerchantTradeNo: delivery.merchantTradeNo,
      });

      // console.log("debug polling logisticsTradeInfo:", logisticsTradeInfo);

      if (
        !logisticsTradeInfo ||
        !logisticsTradeInfo.LogisticsStatus ||
        !logisticsTradeInfo.LogisticsStatusText ||
        !logisticsTradeInfo.DeliveryStatus
      )
        return;

      const result = await updateDeliveryWithNotificationContext(delivery.id, {
        status: logisticsTradeInfo.DeliveryStatus as Delivery["status"],
        RtnCode: String(logisticsTradeInfo.LogisticsStatus),
        RtnMsg: String(logisticsTradeInfo.LogisticsStatusText),
        lastPolledAt: new Date(),
      }, undefined, "provider_poll");

      if (result?.delivery && result.notificationContext) {
        await sendDeliveryNotification({
          ...result.notificationContext,
          delivery: result.delivery,
        });
      }
    } catch (_) {}
  };

  // "pending" | "shipped" | "delivered" | "returned" | "exception"
  const now = new Date();
  const twoHoursAgo = new Date(
    now.getTime() - 2 * 60 * 60 * 1000 + 5 * 60 * 1000,
  ); // 加 5 分鐘 buffer，避免剛好在 2 小時的邊界被漏掉
  const thirtyMinutesAgo = new Date(
    now.getTime() - 30 * 60 * 1000 + 5 * 60 * 1000,
  ); // 加 5 分鐘 buffer，同上

  const deliveries = await db.query.deliveryTable.findMany({
    where: and(
      // eq(t.id, "d5f1228b-e5f8-4dd6-9a68-cc5a906e5b68"),
      isNotNull(schema.deliveryTable.merchantTradeNo),
      isNotNull(schema.deliveryTable.AllPayLogisticsID),
      eq(schema.deliveryTable.LogisticsType, "CVS"),
      or(
        and(
          inArray(schema.deliveryTable.status, ["returned", "exception"]),
          or(
            isNull(schema.deliveryTable.lastPolledAt),
            lt(schema.deliveryTable.lastPolledAt, twoHoursAgo),
          ),
        ),
        and(
          or(
            inArray(schema.deliveryTable.status, ["pending", "shipped", "ready_for_pickup"]),
            // Older callbacks stored store arrival as delivered. Continue polling these until pickup.
            and(eq(schema.deliveryTable.status, "delivered"),
              inArray(schema.deliveryTable.RtnCode, ["2073", "3029", "2063", "3018"])),
          ),
          or(
            isNull(schema.deliveryTable.lastPolledAt),
            lt(schema.deliveryTable.lastPolledAt, thirtyMinutesAgo),
          ),
        ),
      ),
    ),
  });
  console.log(`Num of deliveries to poll: ${deliveries.length}`);

  /**
   * Poll ECPay for delivery status updates based on the following rules:
   * 1. Only CVS deliveries with both merchantTradeNo and AllPayLogisticsID are eligible.
   * 2. Deliveries with 'pending', 'returned', or 'exception' status are polled every 2 hours.
   * 3. Deliveries with 'shipped' or 'ready_for_pickup' status are polled every 30 minutes.
   * 4. If a delivery has never been polled (lastPolledAt is null), it is included in the next poll.
   */

  for (let i = 0; i < deliveries.length; i += 100) {
    const chunk = deliveries.slice(i, i + 100);
    await Promise.all(chunk.map((delivery) => fn(delivery)));
  }
}

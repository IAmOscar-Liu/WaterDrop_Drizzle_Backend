import { logDiagnosticError } from "../lib/requestContext";
import { handleServiceError } from "../lib/error";
import { getRefundStatusBody } from "../lib/refundStatusNotification";
import { generateRefundCreatedEmailHtml, generateRefundStatusChangedEmailHtml } from "../lib/mailTemplate";
import { sendEmail } from "../lib/sendGrid";
import { sendMulticastPushNotification } from "../lib/sendNotification";
import { findOrCreateChatRoom, sendSystemChatMessage } from "../repository/chatroom";
import { createNotification } from "../repository/notification";
import {
  canRefund as canRefundOrderItem,
  createRefund,
  createRefundWithChatContext,
  getRefundById,
  getRefundList,
  GetRefundListParams,
  RefundCreatedChatMessageInput,
  RefundNotificationContext,
  RefundStatusChangedNotificationContext,
  updateRefundItemStatus,
} from "../repository/refund";
import { getFcmTokensInUserIds, getSimpleUserById } from "../repository/user";
import { ServiceResponse } from "../type/general";

async function sendRefundCreatedChatMessage({
  accountId,
  userId,
  productId,
  productVariantId,
  orderId,
  senderType,
  content,
}: RefundCreatedChatMessageInput) {
  const chatRoomResult = await findOrCreateChatRoom({
    userId,
    accountId,
    productId,
    productVariantId,
    orderId,
  });
  const chatRoom = Array.isArray(chatRoomResult)
    ? chatRoomResult[0]
    : chatRoomResult;

  if (!chatRoom) {
    throw new Error("Chat room could not be created");
  }

  await sendSystemChatMessage({
    chatRoomId: chatRoom.id,
    senderType,
    content,
  });
}

function sendRefundCreatedChatMessageAsync(
  input?: RefundCreatedChatMessageInput,
) {
  if (!input) return;

  void sendRefundCreatedChatMessage(input).catch((error) => {
    logDiagnosticError("Failed to send refund chat message", error);
  });
}

function getAppDisplayName() {
  switch (process.env.NODE_ENV!) {
    case "local":
    case "development":
      return "水滴Dev";
    case "stg":
      return "水滴Stg";
    case "production":
      return "水滴";
    default:
      return "水滴Dev";
  }
}

function getProductDisplayName({
  productName,
  variantName,
}: Pick<RefundNotificationContext, "productName" | "variantName">) {
  return variantName?.trim()
    ? `${productName}（${variantName.trim()}）`
    : productName;
}

async function sendRefundCreatedNotifications(
  context: RefundNotificationContext,
) {
  const [fcmTokens, user] = await Promise.all([
    getFcmTokensInUserIds([context.userId]),
    getSimpleUserById(context.userId),
  ]);
  const productDisplayName = getProductDisplayName(context);
  const body = `您的商品「${productDisplayName}」退貨申請已成功送出。(訂單編號: ${context.merchantTradeNo ?? ""})`;

  const savedNotification = await createNotification({
    userId: context.userId,
    type: "order_status",
    title: "退貨申請通知",
    body: `${body}\n如有任何問題，請聯繫客服人員。`,
    orderId: context.orderId,
    metadata: {
      clickAction: "view_order_details",
      refundItemId: context.refundItemId,
    },
  });

  const tasks: Promise<unknown>[] = [
    sendMulticastPushNotification({
      tokens: fcmTokens,
      notification: {
        title: "退貨申請通知",
        body,
      },
      data: {
        notificationId: savedNotification.id,
        command: "refund_updated",
        orderId: context.orderId,
        refundItemId: context.refundItemId,
      },
    }, context.userId),
  ];

  if (user) {
    tasks.push(
      sendEmail({
        to: user.email,
        subject: `[${getAppDisplayName()}]退貨申請通知`,
        html: generateRefundCreatedEmailHtml({
          userName: user.name ?? "",
          merchantTradeNo: context.merchantTradeNo ?? "",
          orderId: context.orderId,
          productName: context.productName,
          variantName: context.variantName,
        }),
      }).then((result) => {
        if (!result.success) throw result.error;
      }),
    );
  }

  await Promise.all(tasks);
}

function sendRefundCreatedNotificationsAsync(
  context?: RefundNotificationContext,
) {
  if (!context) return;

  void sendRefundCreatedNotifications(context).catch((error) => {
    logDiagnosticError("Failed to send refund-created notifications", error);
  });
}

const refundStatusNotificationDependencies = {
  getSimpleUserById,
  getFcmTokensInUserIds,
  createNotification,
  sendEmail,
  sendMulticastPushNotification,
};

export async function sendRefundStatusChangedNotifications(
  context: RefundStatusChangedNotificationContext,
  overrides: Partial<typeof refundStatusNotificationDependencies> = {},
) {
  const dependencies = { ...refundStatusNotificationDependencies, ...overrides };
  const body = getRefundStatusBody(context);
  // Start email independently so an FCM lookup or in-app notification failure cannot suppress it.
  const emailTask = (async () => {
    const user = await dependencies.getSimpleUserById(context.userId);
    if (!user) return;
    const result = await dependencies.sendEmail({
      to: user.email,
      subject: `[${getAppDisplayName()}]退貨狀態更新通知`,
      html: generateRefundStatusChangedEmailHtml({ userName: user.name ?? "", orderId: context.orderId, body, details: context }),
    });
    if (!result.success) throw result.error;
  })();
  const appTask = (async () => {
    const savedNotification = await dependencies.createNotification({
      userId: context.userId,
      type: "order_status",
      title: "退貨狀態更新通知",
      body: `${body}\n如有任何問題，請聯繫客服人員。`,
      orderId: context.orderId,
      metadata: { clickAction: "view_order_details", refundItemId: context.refundItemId },
    });
    const fcmTokens = await dependencies.getFcmTokensInUserIds([context.userId]);
    await dependencies.sendMulticastPushNotification({
      tokens: fcmTokens,
      notification: { title: "退貨狀態更新通知", body },
      data: {
        notificationId: savedNotification.id,
        command: "refund_updated",
        orderId: context.orderId,
        refundItemId: context.refundItemId,
      },
    }, context.userId);
  })();
  const results = await Promise.allSettled([emailTask, appTask]);
  for (const [index, result] of results.entries()) {
    if (result.status === "rejected") {
      logDiagnosticError(`Failed to send refund status ${index === 0 ? "email" : "app notification"}`, result.reason);
    }
  }
}

function sendRefundStatusChangedNotificationsAsync(
  context?: RefundStatusChangedNotificationContext,
) {
  if (!context) return;

  void sendRefundStatusChangedNotifications(context).catch((error) => {
    logDiagnosticError("Failed to send refund status notification", error);
  });
}

class RefundService {
  async getRefundList(
    params: GetRefundListParams,
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof getRefundList>>>> {
    try {
      const refunds = await getRefundList(params);
      return { success: true, data: refunds };
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async getRefundById(
    refundItemId: string,
    accountId: string,
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof getRefundById>>>> {
    try {
      const refund = await getRefundById(refundItemId, accountId);
      if (!refund) {
        return {
          success: false,
          statusCode: 404,
          message: "refund item not found",
        };
      }
      return { success: true, data: refund };
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async createUserRefund(
    item: Parameters<typeof createRefund>[0],
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof createRefund>>>> {
    try {
      const result = await createRefundWithChatContext(item);
      if (result.chatMessageInput) sendRefundCreatedChatMessageAsync(result.chatMessageInput);
      if (result.notificationContext) sendRefundCreatedNotificationsAsync(result.notificationContext);
      return { success: true, data: result.refundItem };
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async updateRefundItemStatus(
    refundItemId: string,
    updates: Parameters<typeof updateRefundItemStatus>[1],
    actorAccountId: string,
  ): Promise<
    ServiceResponse<
      Awaited<ReturnType<typeof updateRefundItemStatus>>["refundItem"]
    >
  > {
    try {
      const result = await updateRefundItemStatus(
        refundItemId,
        updates,
        actorAccountId,
      );
      sendRefundStatusChangedNotificationsAsync(result.notificationContext);
      return { success: true, data: result.refundItem };
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async canRefund(orderItemId: string): Promise<boolean> {
    try {
      return await canRefundOrderItem(orderItemId);
    } catch (error) {
      return false;
    }
  }
}

export default new RefundService();

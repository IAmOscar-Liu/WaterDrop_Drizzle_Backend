import { handleServiceError } from "../lib/error";
import { isAccountAdmin } from "../repository/account";
import { findOrCreateChatRoom, sendChatMessage } from "../repository/chatroom";
import {
  canRefund as canRefundOrderItem,
  createRefund,
  createRefundWithChatContext,
  getRefundById,
  getRefundList,
  GetRefundListParams,
  RefundCreatedChatMessageInput,
  updateRefundItemStatus,
} from "../repository/refund";
import { ServiceResponse } from "../type/general";

async function sendRefundCreatedChatMessage({
  accountId,
  userId,
  productId,
  orderId,
  senderType,
  content,
}: RefundCreatedChatMessageInput) {
  const chatRoomResult = await findOrCreateChatRoom({
    userId,
    accountId,
    productId,
    orderId,
  });
  const chatRoom = Array.isArray(chatRoomResult)
    ? chatRoomResult[0]
    : chatRoomResult;

  if (!chatRoom) {
    throw new Error("Chat room could not be created");
  }

  await sendChatMessage({
    chatRoomId: chatRoom.id,
    senderType:
      senderType ?? ((await isAccountAdmin(accountId)) ? "admin" : "seller"),
    content,
  });
}

function sendRefundCreatedChatMessageAsync(
  input?: RefundCreatedChatMessageInput,
) {
  if (!input) return;

  void sendRefundCreatedChatMessage(input).catch((error) => {
    console.error("Failed to send refund chat message:", error);
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
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof getRefundById>>>> {
    try {
      const refund = await getRefundById(refundItemId);
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

  async createRefund(
    item: Parameters<typeof createRefund>[0],
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof createRefund>>>> {
    try {
      const result = await createRefundWithChatContext(item);
      sendRefundCreatedChatMessageAsync(result.chatMessageInput);
      return { success: true, data: result.refundItem };
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async createUserRefund(
    item: Parameters<typeof createRefund>[0],
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof createRefund>>>> {
    try {
      const result = await createRefundWithChatContext(item);
      sendRefundCreatedChatMessageAsync(result.chatMessageInput);
      return { success: true, data: result.refundItem };
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async updateRefundItemStatus(
    refundItemId: string,
    updates: Parameters<typeof updateRefundItemStatus>[1],
  ): Promise<
    ServiceResponse<Awaited<ReturnType<typeof updateRefundItemStatus>>>
  > {
    try {
      const refund = await updateRefundItemStatus(refundItemId, updates);
      return { success: true, data: refund };
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

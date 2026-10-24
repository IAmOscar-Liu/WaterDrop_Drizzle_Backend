/** Failed checkouts are not a buyer-visible order, even if legacy logistics exist. */
export function visibleChatOrder<T extends { orderStatus: string }>(order: T | null | undefined): T | null {
  return order && order.orderStatus !== "failed" ? order : null;
}

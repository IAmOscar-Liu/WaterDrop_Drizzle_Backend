import { and, eq, isNull, sql } from "drizzle-orm";
import db from "../lib/initDB";
import * as schema from "../db/schema";
import { isConfirmedReceipt, getRefundWindowMs } from "../lib/refundEligibility";

export type RefundTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type ReceiptSource = "provider_callback" | "provider_poll";
export type AccountReceiptConfirmation = {
  source: "seller_confirmation" | "admin_confirmation";
  actorAccountId: string;
  actorRole: "seller" | "admin";
};

export async function lockRefundOrder(tx: RefundTx, orderId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`refund-order:${orderId}`}, 0))`);
}

export async function refundClock(tx: RefundTx) {
  const [row] = await tx.execute<{ at: string }>(sql`select clock_timestamp()::text as at`);
  return new Date(row.at);
}

// Only trusted integration/confirmation callers supply source and actor evidence, never HTTP body fields.
export async function captureReceipt(
  tx: RefundTx,
  delivery: schema.Delivery,
  source?: ReceiptSource | AccountReceiptConfirmation,
  previousDelivery?: schema.Delivery,
) {
  let receivedAt = delivery.receivedAt;
  const accountConfirmation = typeof source === "object" ? source : undefined;
  const confirmed = accountConfirmation
    ? delivery.status === "delivered" && ["virtual", "home_delivery"].includes(delivery.LogisticsType)
    : isConfirmedReceipt(delivery);
  if (!receivedAt && source && confirmed) {
    // A later repeated poll cannot manufacture a new pickup time for a historical record,
    // including records whose original delivery log was never written.
    if (!accountConfirmation && previousDelivery && isConfirmedReceipt(previousDelivery)) return delivery;
    const prior = await tx.query.deliveryLogTable.findMany({
      where: eq(schema.deliveryLogTable.deliveryId, delivery.id),
    });
    if (!accountConfirmation && prior.some(log => isConfirmedReceipt({
      ...delivery,
      status: log.status,
      RtnCode: log.RtnCode,
    }))) return delivery;

    receivedAt = await refundClock(tx);
    const evidence = {
      source: accountConfirmation?.source ?? source,
      ...(accountConfirmation ? { actorAccountId: accountConfirmation.actorAccountId, actorRole: accountConfirmation.actorRole,
        confirmedAt: receivedAt.toISOString() } : {}),
      observedAt: receivedAt.toISOString(),
      estimated: !accountConfirmation,
      logisticsType: delivery.LogisticsType,
      logisticsSubType: delivery.LogisticsSubType,
      code: delivery.RtnCode,
    };
    await tx.update(schema.deliveryTable)
      .set({ receivedAt, receiptEvidence: evidence })
      .where(eq(schema.deliveryTable.id, delivery.id));
    delivery = { ...delivery, receivedAt, receiptEvidence: evidence };
  }

  if (receivedAt) {
    const items = await tx.select().from(schema.orderItemTable).where(and(
      eq(schema.orderItemTable.deliveryId, delivery.id),
      isNull(schema.orderItemTable.refundWindowStartsAt),
    )).orderBy(schema.orderItemTable.id).for("update");
    for (const item of items) {
      const hours = item.refundWindowHoursAtSale;
      const deadline = hours === null || hours === 0 ? null
        : new Date(receivedAt.getTime() + getRefundWindowMs(hours));
      await tx.update(schema.orderItemTable).set({
        refundWindowStartsAt: receivedAt,
        originalRefundDeadlineAt: deadline,
        refundDeadlineAt: deadline,
      }).where(and(eq(schema.orderItemTable.id, item.id), isNull(schema.orderItemTable.refundWindowStartsAt)));
    }
  }
  return delivery;
}

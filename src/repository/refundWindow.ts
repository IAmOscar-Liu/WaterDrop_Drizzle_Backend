import { and, eq, isNull, sql } from "drizzle-orm";
import db from "../lib/initDB";
import * as schema from "../db/schema";
import { isConfirmedReceipt, getRefundWindowMs } from "../lib/refundEligibility";

export type RefundTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type ReceiptSource = "provider_callback" | "provider_poll";

export async function lockRefundOrder(tx: RefundTx, orderId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`refund-order:${orderId}`}, 0))`);
}

export async function refundClock(tx: RefundTx) {
  const [row] = await tx.execute<{ at: string }>(sql`select clock_timestamp()::text as at`);
  return new Date(row.at);
}

// Only trusted integration callers supply source, never HTTP body fields.
export async function captureReceipt(
  tx: RefundTx,
  delivery: schema.Delivery,
  source?: ReceiptSource,
  previousDelivery?: schema.Delivery,
) {
  let receivedAt = delivery.receivedAt;
  if (!receivedAt && source && isConfirmedReceipt(delivery)) {
    // A later repeated poll cannot manufacture a new pickup time for a historical record,
    // including records whose original delivery log was never written.
    if (previousDelivery && isConfirmedReceipt(previousDelivery)) return delivery;
    const prior = await tx.query.deliveryLogTable.findMany({
      where: eq(schema.deliveryLogTable.deliveryId, delivery.id),
    });
    if (prior.some(log => isConfirmedReceipt({
      ...delivery,
      status: log.status,
      RtnCode: log.RtnCode,
    }))) return delivery;

    receivedAt = await refundClock(tx);
    const evidence = {
      source,
      observedAt: receivedAt.toISOString(),
      estimated: true,
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
    const deadline = new Date(receivedAt.getTime() + getRefundWindowMs());
    await tx.update(schema.orderItemTable).set({
      refundWindowStartsAt: receivedAt,
      originalRefundDeadlineAt: deadline,
      refundDeadlineAt: deadline,
    }).where(and(
      eq(schema.orderItemTable.deliveryId, delivery.id),
      isNull(schema.orderItemTable.refundWindowStartsAt),
    ));
  }
  return delivery;
}

import {
  and,
  count,
  countDistinct,
  eq,
  gt,
  inArray,
  SQL,
  sql,
} from "drizzle-orm";
import * as schema from "../db/schema";
import { CustomError } from "../lib/error";
import db from "../lib/initDB";
import { resolveAdminSellerScope } from "./adminScope";
import { compactConditions } from "./utils/query";

export type SidebarSection = schema.AdminSidebarReadState["section"];
const sidebarSections: SidebarSection[] = [
  "orders",
  "deliveries",
  "refunds",
  "advertisements",
  "chatrooms",
];

const processCutoverAt = (() => {
  const configured = process.env.ADMIN_SIDEBAR_CUTOVER_AT;
  if (!configured) return new Date();
  const value = new Date(configured);
  return Number.isNaN(value.getTime()) ? new Date() : value;
})();

export async function initializeSidebarReadStatesWithTx(
  tx: any,
  accountId: string,
  scopeKey: string,
  seenAt = new Date(),
) {
  await tx
    .insert(schema.adminSidebarReadStateTable)
    .values(
      sidebarSections.map((section) => ({
        accountId,
        scopeKey,
        section,
        lastSeenAt: seenAt,
      })),
    )
    .onConflictDoNothing();
}

async function getStates(accountId: string, scopeKey: string) {
  const rows = await db
    .select()
    .from(schema.adminSidebarReadStateTable)
    .where(
      and(
        eq(schema.adminSidebarReadStateTable.accountId, accountId),
        eq(schema.adminSidebarReadStateTable.scopeKey, scopeKey),
      ),
    );
  return new Map(rows.map((row) => [row.section, row.lastSeenAt]));
}

export async function getSidebarNotificationSummary(input: {
  requesterId: string;
  sellerId?: string;
}) {
  const scope = await resolveAdminSellerScope(input.requesterId, input.sellerId);
  const scopeKey = scope.sellerId ?? "platform";
  const states = await getStates(input.requesterId, scopeKey);
  const seen = Object.fromEntries(
    sidebarSections.map((section) => [
      section,
      states.get(section) ?? processCutoverAt,
    ]),
  ) as Record<SidebarSection, Date>;
  const sellerCondition = scope.sellerId
    ? eq(schema.productTable.sellerId, scope.sellerId)
    : undefined;

  const [orders, deliveries, refunds, advertisements, chatrooms] =
    await Promise.all([
      countOrderBadges(sellerCondition, seen.orders),
      countDeliveryBadges(sellerCondition, seen.deliveries),
      countRefundBadges(sellerCondition, seen.refunds),
      countAdvertisementBadges(sellerCondition, seen.advertisements),
      countChatroomBadges(scope.sellerId, seen.chatrooms),
    ]);
  return {
    sellerId: scope.sellerId ?? null,
    scopeKey,
    sections: { orders, deliveries, refunds, advertisements, chatrooms },
  };
}

export async function markSidebarSectionSeen(input: {
  requesterId: string;
  sellerId?: string;
  section: SidebarSection;
  seenAt?: Date;
}) {
  const scope = await resolveAdminSellerScope(input.requesterId, input.sellerId);
  const scopeKey = scope.sellerId ?? "platform";
  const seenAt = input.seenAt ?? new Date();
  if (seenAt.getTime() > Date.now() + 5 * 60_000) {
    throw new CustomError("seenAt cannot be in the future", 400);
  }
  const [state] = await db
    .insert(schema.adminSidebarReadStateTable)
    .values({
      accountId: input.requesterId,
      scopeKey,
      section: input.section,
      lastSeenAt: seenAt,
    })
    .onConflictDoUpdate({
      target: [
        schema.adminSidebarReadStateTable.accountId,
        schema.adminSidebarReadStateTable.scopeKey,
        schema.adminSidebarReadStateTable.section,
      ],
      set: {
        lastSeenAt: sql`greatest(${schema.adminSidebarReadStateTable.lastSeenAt}, ${seenAt.toISOString()}::timestamptz)`,
        updatedAt: new Date(),
      },
    })
    .returning();
  return state;
}

async function countOrderBadges(seller: SQL | undefined, lastSeenAt: Date) {
  const [row] = await db
    .select({
      actionableTotal: sql<number>`count(distinct ${schema.orderTable.id}) filter (where ${schema.orderTable.orderStatus} in ('pending', 'payment-processing'))`.mapWith(Number),
      newSinceLastSeen: sql<number>`count(distinct ${schema.orderTable.id}) filter (where ${schema.orderTable.createdAt} > ${lastSeenAt.toISOString()}::timestamptz)`.mapWith(Number),
    })
    .from(schema.orderItemTable)
    .innerJoin(schema.orderTable, eq(schema.orderTable.id, schema.orderItemTable.orderId))
    .innerJoin(schema.productTable, eq(schema.productTable.id, schema.orderItemTable.productId))
    .where(compactConditions([seller]));
  return { ...row, lastSeenAt: lastSeenAt.toISOString() };
}

async function countDeliveryBadges(seller: SQL | undefined, lastSeenAt: Date) {
  const [row] = await db
    .select({
      actionableTotal: sql<number>`count(distinct ${schema.deliveryTable.id}) filter (where ${schema.deliveryTable.status} in ('pending', 'exception', 'unknown'))`.mapWith(Number),
      newSinceLastSeen: sql<number>`count(distinct ${schema.deliveryTable.id}) filter (where ${schema.deliveryTable.updatedAt} > ${lastSeenAt.toISOString()}::timestamptz)`.mapWith(Number),
    })
    .from(schema.deliveryTable)
    .innerJoin(schema.orderItemTable, eq(schema.orderItemTable.orderId, schema.deliveryTable.orderId))
    .innerJoin(schema.productTable, eq(schema.productTable.id, schema.orderItemTable.productId))
    .where(compactConditions([seller]));
  return { ...row, lastSeenAt: lastSeenAt.toISOString() };
}

async function countRefundBadges(seller: SQL | undefined, lastSeenAt: Date) {
  const [row] = await db
    .select({
      actionableTotal: sql<number>`count(distinct ${schema.refundItemTable.id}) filter (where ${schema.refundItemTable.status} in ('pending', 'processing'))`.mapWith(Number),
      newSinceLastSeen: sql<number>`count(distinct ${schema.refundItemTable.id}) filter (where ${schema.refundItemTable.updatedAt} > ${lastSeenAt.toISOString()}::timestamptz)`.mapWith(Number),
    })
    .from(schema.refundItemTable)
    .innerJoin(schema.orderItemTable, eq(schema.orderItemTable.id, schema.refundItemTable.orderItemId))
    .innerJoin(schema.productTable, eq(schema.productTable.id, schema.orderItemTable.productId))
    .where(compactConditions([seller]));
  return { ...row, lastSeenAt: lastSeenAt.toISOString() };
}

async function countAdvertisementBadges(seller: SQL | undefined, lastSeenAt: Date) {
  const [row] = await db
    .select({
      actionableTotal: sql<number>`count(*) filter (where ${schema.advertisementStatsTable.status} in ('depleted', 'paused'))`.mapWith(Number),
      newSinceLastSeen: sql<number>`count(*) filter (where ${schema.advertisementStatsTable.updatedAt} > ${lastSeenAt.toISOString()}::timestamptz)`.mapWith(Number),
    })
    .from(schema.advertisementTable)
    .innerJoin(schema.productTable, eq(schema.productTable.id, schema.advertisementTable.productId))
    .innerJoin(schema.advertisementStatsTable, eq(schema.advertisementStatsTable.advertisementId, schema.advertisementTable.id))
    .where(compactConditions([seller]));
  return { ...row, lastSeenAt: lastSeenAt.toISOString() };
}

async function countChatroomBadges(sellerId: string | undefined, lastSeenAt: Date) {
  const [row] = await db
    .select({
      actionableTotal: sql<number>`count(distinct ${schema.chatRoomTable.id}) filter (where ${schema.chatMessageTable.senderType} = 'user' and ${schema.chatMessageTable.isRead} = false)`.mapWith(Number),
      newSinceLastSeen: sql<number>`count(distinct ${schema.chatRoomTable.id}) filter (where ${schema.chatMessageTable.senderType} = 'user' and ${schema.chatMessageTable.createdAt} > ${lastSeenAt.toISOString()}::timestamptz)`.mapWith(Number),
    })
    .from(schema.chatRoomTable)
    .leftJoin(schema.chatMessageTable, eq(schema.chatMessageTable.chatRoomId, schema.chatRoomTable.id))
    .where(
      compactConditions([
        sellerId ? eq(schema.chatRoomTable.accountId, sellerId) : undefined,
      ]),
    );
  return { ...row, lastSeenAt: lastSeenAt.toISOString() };
}

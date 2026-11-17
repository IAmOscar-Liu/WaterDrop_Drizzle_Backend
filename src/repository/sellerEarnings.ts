import { snapshotShipments } from "./shippingReimbursement";
import { and, asc, desc, eq, gte, inArray, lte, sql, count } from "drizzle-orm";
import * as s from "../db/schema";
import db from "../lib/initDB";
import { CustomError } from "../lib/error";
import { amount, units, min, UNIT, earningsHoldMs, earningsLaunchAt } from "../lib/earningsMoney";
import { getActiveAdminAccount } from "./adminScope";

export type EarningsTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Lot = typeof s.sellerRevenueLotTable.$inferSelect;
export async function earningsScope(actorId: string, sellerId?: string, adminOnly = false) {
  const actor = await getActiveAdminAccount(actorId);
  if (actor.role === "employee" || (adminOnly && actor.role !== "admin")) throw new CustomError("Seller or administrator access required", 403);
  if (actor.role === "seller" && sellerId && actor.id !== sellerId) throw new CustomError("Cannot access another seller", 403);
  const target = sellerId ?? (actor.role === "seller" ? actor.id : undefined);
  if (!target) throw new CustomError("sellerId is required for administrators", 400);
  const seller = await db.query.accountTable.findFirst({ where: eq(s.accountTable.id, target) });
  if (!seller || seller.role !== "seller") throw new CustomError("Seller not found", 404);
  return target;
}
export async function lockRevenue(tx: EarningsTx, sellerId: string) {
  await tx.insert(s.sellerRevenueAccountTable).values({ sellerId }).onConflictDoNothing();
  const [account] = await tx.select().from(s.sellerRevenueAccountTable).where(eq(s.sellerRevenueAccountTable.sellerId, sellerId)).for("update");
  return account;
}
export async function revenueState(tx: EarningsTx, sellerId: string) {
  const lots = await tx.select().from(s.sellerRevenueLotTable).where(eq(s.sellerRevenueLotTable.sellerId, sellerId)).orderBy(asc(s.sellerRevenueLotTable.createdAt), asc(s.sellerRevenueLotTable.id));
  const requests = await tx.select().from(s.sellerWalletRequestTable).where(and(eq(s.sellerWalletRequestTable.sellerId, sellerId), eq(s.sellerWalletRequestTable.wallet, "revenue"), inArray(s.sellerWalletRequestTable.status, ["pending", "processing"])));
  return { lots, requests };
}
export function sumLots(lots: Lot[], field: "cash" | "coinValue", released?: boolean) {
  return lots.filter(l => released === undefined || l.released === released).reduce((n, l) => n + units(l[field]), BigInt(0));
}

// Caller serializes all mutations for this seller with lockRevenue.
export async function postRevenue(tx: EarningsTx, input: {
  sellerId: string; eventKey: string; type: string; cash: bigint; coinValue: bigint;
  orderItemId?: string; releaseAt?: Date; released?: boolean; grossCash?: bigint; grossCoinValue?: bigint;
  actorAccountId?: string; detail?: Record<string, unknown>; at?: Date; adjustment?: boolean;
}) {
  const account = await lockRevenue(tx, input.sellerId);
  const existing = await tx.query.sellerRevenueEventTable.findFirst({ where: eq(s.sellerRevenueEventTable.eventKey, input.eventKey) });
  if (existing) return existing;
  let debt = units(account.debt);
  const { lots, requests } = await revenueState(tx, input.sellerId);
  const protectedCash = requests.filter(r => r.status === "processing").reduce((n,r) => n + units(r.cash), BigInt(0));
  const protectedCoin = requests.filter(r => r.status === "processing").reduce((n,r) => n + units(r.coins) / BigInt(10), BigInt(0));
  let releasedCashAllowance = sumLots(lots, "cash", true) - protectedCash;
  let releasedCoinAllowance = sumLots(lots, "coinValue", true) - protectedCoin;
  const allocations: Array<Record<string, unknown>> = [];
  async function take(lot: Lot, field: "cash" | "coinValue", needed: bigint) {
    let available = units(lot[field]);
    if (lot.released) available = min(available, field === "cash" ? releasedCashAllowance : releasedCoinAllowance);
    const taken = min(needed, available > BigInt(0) ? available : BigInt(0));
    if (!taken) return needed;
    lot[field] = amount(units(lot[field]) - taken);
    if (lot.released) { if (field === "cash") releasedCashAllowance -= taken; else releasedCoinAllowance -= taken; }
    await tx.update(s.sellerRevenueLotTable).set({ [field]: lot[field] }).where(eq(s.sellerRevenueLotTable.id, lot.id));
    allocations.push({ lotId: lot.id, currency: field, amount: amount(taken) });
    return needed - taken;
  }
  let cash = input.cash, coin = input.coinValue;
  if (cash >= BigInt(0) && coin >= BigInt(0)) {
    const cashOffset = min(cash, debt); cash -= cashOffset; debt -= cashOffset;
    const coinOffset = min(coin, debt); coin -= coinOffset; debt -= coinOffset;
    await tx.insert(s.sellerRevenueLotTable).values({ sellerId: input.sellerId, sourceKey: input.eventKey,
      orderItemId: input.orderItemId, cash: amount(cash), coinValue: amount(coin),
      releaseAt: input.releaseAt ?? new Date(), released: input.released ?? false });
    allocations.push({ debtOffset: amount(cashOffset + coinOffset) });
  } else {
    let cashNeed = -cash, coinNeed = -coin;
    const own = lots.filter(l => input.orderItemId && l.orderItemId === input.orderItemId);
    for (const l of own) { cashNeed = await take(l, "cash", cashNeed); coinNeed = await take(l, "coinValue", coinNeed); }
    if (input.adjustment) {
      for (const released of [true, false]) for (const l of lots.filter(l => l.released === released)) {
        cashNeed = await take(l, "cash", cashNeed); coinNeed = await take(l, "coinValue", coinNeed);
      }
    }
    let remaining = cashNeed + coinNeed;
    for (const released of [true, false]) for (const field of ["cash", "coinValue"] as const) {
      for (const l of lots.filter(l => l.released === released)) remaining = await take(l, field, remaining);
    }
    debt += remaining;
    // Keep only pending withdrawals whose original composition remains funded.
    let availableCash = sumLots(lots, "cash", true) - protectedCash;
    let availableCoin = sumLots(lots, "coinValue", true) - protectedCoin;
    for (const r of requests.filter(r => r.status === "pending").sort((a,b) => a.createdAt.getTime()-b.createdAt.getTime() || a.id.localeCompare(b.id))) {
      if (units(r.cash) > availableCash || units(r.coins)/BigInt(10) > availableCoin) {
        await tx.update(s.sellerWalletRequestTable).set({ status: "cancelled", reason: "Revenue deduction made the requested composition unavailable", updatedAt: new Date(),
          history: [...r.history, { status: "cancelled", reason: "revenue_deduction", at: new Date().toISOString() }] }).where(eq(s.sellerWalletRequestTable.id,r.id));
      } else { availableCash -= units(r.cash); availableCoin -= units(r.coins)/BigInt(10); }
    }
  }
  await tx.update(s.sellerRevenueAccountTable).set({ debt: amount(debt) }).where(eq(s.sellerRevenueAccountTable.sellerId,input.sellerId));
  const [event] = await tx.insert(s.sellerRevenueEventTable).values({ sellerId: input.sellerId, eventKey: input.eventKey, type: input.type,
    cash: amount(input.cash), coinValue: amount(input.coinValue), grossCash: amount(input.grossCash ?? BigInt(0)), grossCoinValue: amount(input.grossCoinValue ?? BigInt(0)),
    debtAfter: amount(debt), actorAccountId: input.actorAccountId, createdAt: input.at ?? new Date(), detail: { ...input.detail, allocations } }).returning();
  return event;
}

export async function postPaidOrderRevenue(tx: EarningsTx, orderId: string) {
  const launch = earningsLaunchAt();
  if (!launch) return;
  const order = await tx.query.orderTable.findFirst({ where: eq(s.orderTable.id,orderId) });
  if (!order?.completedAt || order.completedAt < launch || order.orderStatus !== "paid") return;
  const rows = await tx.select({ item: s.orderItemTable, sellerId: s.productTable.sellerId }).from(s.orderItemTable)
    .innerJoin(s.productTable,eq(s.productTable.id,s.orderItemTable.productId)).where(eq(s.orderItemTable.orderId,orderId)).orderBy(s.orderItemTable.id);
  const total = rows.reduce((n,r) => n + units(r.item.lineTotal),BigInt(0));
  const coinTotal = units(order.discountCoin ?? 0)/BigInt(10);
  if (coinTotal > total) throw new CustomError("Invalid sale coin allocation",409);
  let cumulative = BigInt(0), allocated = BigInt(0);
  const snapshots = rows.map(row => {
    const value = units(row.item.lineTotal); cumulative += value;
    const target = total ? coinTotal*cumulative/total : BigInt(0);
    const coin = target-allocated; allocated=target;
    return {...row,value,coin,cash:value-coin};
  });
  for (const sellerId of [...new Set(rows.map(r=>r.sellerId))].sort()) await lockRevenue(tx,sellerId);
  for (const row of snapshots) {
    const prior = await tx.query.sellerSaleSnapshotTable.findFirst({ where:eq(s.sellerSaleSnapshotTable.orderItemId,row.item.id) });
    if (prior) continue;
    await tx.insert(s.sellerSaleSnapshotTable).values({ orderItemId:row.item.id,sellerId:row.sellerId,grossCash:amount(row.cash),grossCoinValue:amount(row.coin),productValue:amount(row.value),confirmedAt:order.completedAt });
    await postRevenue(tx,{sellerId:row.sellerId,eventKey:`sale:${row.item.id}`,type:"sale",orderItemId:row.item.id,
      cash:row.value*BigInt(9)/BigInt(10)-row.coin*BigInt(9)/BigInt(10),coinValue:row.coin*BigInt(9)/BigInt(10),grossCash:row.cash,grossCoinValue:row.coin,
      releaseAt:new Date(order.completedAt.getTime()+earningsHoldMs()),at:order.completedAt,
      detail:{commissionRate:"0.10",coinToCurrencyRate:"10",commissionCash:amount(row.cash-(row.value*BigInt(9)/BigInt(10)-row.coin*BigInt(9)/BigInt(10))),commissionCoinValue:amount(row.coin-row.coin*BigInt(9)/BigInt(10)),orderId}});
  }
  await snapshotShipments(tx, order);
}
export async function postRefundRevenue(tx: EarningsTx, refund: typeof s.refundItemTable.$inferSelect) {
  const sale = await tx.query.sellerSaleSnapshotTable.findFirst({where:eq(s.sellerSaleSnapshotTable.orderItemId,refund.orderItemId)});
  if (!sale) return; // Legacy sales never credited this wallet.
  await lockRevenue(tx,sale.sellerId);
  if (await tx.query.sellerRevenueEventTable.findFirst({where:eq(s.sellerRevenueEventTable.eventKey,`refund:${refund.id}`)})) return;
  const [locked] = await tx.select().from(s.sellerSaleSnapshotTable).where(eq(s.sellerSaleSnapshotTable.orderItemId,refund.orderItemId)).for("update");
  const value=units(locked.productValue), before=units(locked.refundedValue);
  const after=min(value,before+units(refund.refundAmount ?? 0)*BigInt(refund.quantity));
  const delta=(base:bigint)=>value ? base*after/value-base*before/value : BigInt(0);
  const gc=delta(units(locked.grossCash)), gcoin=delta(units(locked.grossCoinValue));
  await postRevenue(tx,{sellerId:sale.sellerId,eventKey:`refund:${refund.id}`,type:"refund",orderItemId:refund.orderItemId,
    cash:-delta(value*BigInt(9)/BigInt(10)-units(locked.grossCoinValue)*BigInt(9)/BigInt(10))-units(refund.extraRefundAmount ?? 0),coinValue:-delta(units(locked.grossCoinValue)*BigInt(9)/BigInt(10)),
    grossCash:-gc,grossCoinValue:-gcoin,detail:{refundId:refund.id,extraRefundAmount:refund.extraRefundAmount,commissionCash:amount(-(gc-delta(value*BigInt(9)/BigInt(10)-units(locked.grossCoinValue)*BigInt(9)/BigInt(10)))),commissionCoinValue:amount(-(gcoin-delta(units(locked.grossCoinValue)*BigInt(9)/BigInt(10))))}});
  await tx.update(s.sellerSaleSnapshotTable).set({refundedValue:amount(after)}).where(eq(s.sellerSaleSnapshotTable.orderItemId,refund.orderItemId));
}
export async function releaseSellerEarnings(now = new Date()) {
  // Catch-up uses today's scheduled cutoff, never an earlier-than-03:00 release.
  const taipeiDay = new Date(now.getTime()+8*3600_000).toISOString().slice(0,10);
  let cutoff = new Date(`${taipeiDay}T03:00:00+08:00`);
  if (cutoff > now) cutoff = new Date(cutoff.getTime()-86400_000);
  const due=await db.selectDistinct({sellerId:s.sellerRevenueLotTable.sellerId}).from(s.sellerRevenueLotTable).where(and(eq(s.sellerRevenueLotTable.released,false),lte(s.sellerRevenueLotTable.releaseAt,cutoff)));
  for (const {sellerId} of due) await db.transaction(async tx=>{
    const account=await lockRevenue(tx,sellerId);
    const lots=await tx.update(s.sellerRevenueLotTable).set({released:true}).where(and(eq(s.sellerRevenueLotTable.sellerId,sellerId),eq(s.sellerRevenueLotTable.released,false),lte(s.sellerRevenueLotTable.releaseAt,cutoff))).returning();
    for (const lot of lots) await tx.insert(s.sellerRevenueEventTable).values({sellerId,eventKey:`release:${lot.id}`,type:"release",debtAfter:account.debt,detail:{lotId:lot.id,cash:lot.cash,coinValue:lot.coinValue,cutoff:cutoff.toISOString()}}).onConflictDoNothing();
  });
  return { sellers:due.length,cutoff };
}
export async function earningsSummary(actorId:string,sellerId?:string,startAt?:Date,endAt?:Date) {
  if(startAt && endAt && startAt > endAt) throw new CustomError("startAt must precede endAt",400);
  const target=await earningsScope(actorId,sellerId);
  return db.transaction(async tx=>{
    const account=await lockRevenue(tx,target);
    const {lots,requests}=await revenueState(tx,target);
    const reservedCash=requests.reduce((n,r)=>n+units(r.cash),BigInt(0)), reservedCoin=requests.reduce((n,r)=>n+units(r.coins)/BigInt(10),BigInt(0));
    const cash=sumLots(lots,"cash"), coin=sumLots(lots,"coinValue"), releasedCash=sumLots(lots,"cash",true),releasedCoin=sumLots(lots,"coinValue",true);
    const [totals]=await tx.select({cash:sql<string>`coalesce(sum(${s.sellerRevenueEventTable.grossCash}),0)`,coin:sql<string>`coalesce(sum(${s.sellerRevenueEventTable.grossCoinValue}),0)`}).from(s.sellerRevenueEventTable).where(and(eq(s.sellerRevenueEventTable.sellerId,target),startAt?gte(s.sellerRevenueEventTable.createdAt,startAt):undefined,endAt?lte(s.sellerRevenueEventTable.createdAt,endAt):undefined));
    const breakdown=await tx.select({
      type:s.sellerRevenueEventTable.type,
      cash:sql<string>`sum(${s.sellerRevenueEventTable.cash})::text`,
      coinValue:sql<string>`sum(${s.sellerRevenueEventTable.coinValue})::text`,
      grossCash:sql<string>`sum(${s.sellerRevenueEventTable.grossCash})::text`,
      grossCoinValue:sql<string>`sum(${s.sellerRevenueEventTable.grossCoinValue})::text`,
      commissionCash:sql<string>`coalesce(sum((${s.sellerRevenueEventTable.detail}->>'commissionCash')::numeric),0)::text`,
      commissionCoinValue:sql<string>`coalesce(sum((${s.sellerRevenueEventTable.detail}->>'commissionCoinValue')::numeric),0)::text`,
      extraRefundAmount:sql<string>`coalesce(sum((${s.sellerRevenueEventTable.detail}->>'extraRefundAmount')::numeric),0)::text`,
    }).from(s.sellerRevenueEventTable).where(and(eq(s.sellerRevenueEventTable.sellerId,target),startAt?gte(s.sellerRevenueEventTable.createdAt,startAt):undefined,endAt?lte(s.sellerRevenueEventTable.createdAt,endAt):undefined)).groupBy(s.sellerRevenueEventTable.type);
    const accountingWarnings = await tx.select({shipmentId:s.sellerShipmentSnapshotTable.id,orderId:s.sellerShipmentSnapshotTable.orderId})
      .from(s.sellerShipmentSnapshotTable).where(and(eq(s.sellerShipmentSnapshotTable.sellerId,target),sql`${s.sellerShipmentSnapshotTable.buyerPaidAmount} is null or (${s.sellerShipmentSnapshotTable.logisticsType} = 'CVS' and ${s.sellerShipmentSnapshotTable.standardCost} is null)`));
    const canCash=units(account.debt)>BigInt(0)?BigInt(0):(releasedCash-reservedCash)/UNIT*UNIT;
    const canCoin=units(account.debt)>BigInt(0)?BigInt(0):(releasedCoin-reservedCoin)/UNIT*UNIT;
    return {sellerId:target,breakdown,accountingWarnings,
      pendingCash:amount(cash-releasedCash),pendingCoins:amount((coin-releasedCoin)*BigInt(10)),
      releasedCash:amount(releasedCash),releasedCoins:amount(releasedCoin*BigInt(10)),
      reservedCash:amount(reservedCash),reservedCoins:amount(reservedCoin*BigInt(10)),
      retainedCashRemainder:amount((releasedCash-reservedCash)%UNIT),retainedCoinsRemainder:amount((releasedCoin-reservedCoin)%UNIT*BigInt(10)),cashBalance:amount(cash),coinBalance:amount(coin*BigInt(10)),pendingAmount:amount(cash+coin-releasedCash-releasedCoin),releasedAmount:amount(releasedCash+releasedCoin),reservedAmount:amount(reservedCash+reservedCoin),withdrawableCash:amount(canCash),withdrawableCoins:amount(canCoin*BigInt(10)),withdrawableAmount:amount(canCash+canCoin),debt:account.debt,cashEarnings:amount(units(totals.cash)),coinEarnings:amount(units(totals.coin)*BigInt(10)),coverageStart:earningsLaunchAt(),startAt:startAt??null,endAt:endAt??null,asOf:new Date()};
  });
}
export async function earningsHistory(actorId:string,input:{sellerId?:string;startAt?:Date;endAt?:Date;page?:number;limit?:number}) {
  if(input.startAt && input.endAt && input.startAt > input.endAt) throw new CustomError("startAt must precede endAt",400);
  const sellerId=await earningsScope(actorId,input.sellerId),page=input.page??1,limit=input.limit??20;
  const where=and(eq(s.sellerRevenueEventTable.sellerId,sellerId),input.startAt?gte(s.sellerRevenueEventTable.createdAt,input.startAt):undefined,input.endAt?lte(s.sellerRevenueEventTable.createdAt,input.endAt):undefined);
  const [rows,[total]]=await Promise.all([db.select().from(s.sellerRevenueEventTable).where(where).orderBy(desc(s.sellerRevenueEventTable.createdAt),desc(s.sellerRevenueEventTable.id)).limit(limit).offset((page-1)*limit),db.select({n:count()}).from(s.sellerRevenueEventTable).where(where)]);
  return {transactions:rows,page,limit,total:total.n,totalPages:Math.ceil(total.n/limit)};
}
export async function adjustRevenue(actorId:string,sellerId:string,input:{direction:"increase"|"decrease";cash:string;coins:string;reason:string;idempotencyKey:string}) {
  await earningsScope(actorId,sellerId,true);
  return db.transaction(async tx=>{
    await lockRevenue(tx,sellerId);
    const key=`adjustment:${sellerId}:${input.idempotencyKey}`;
    const existing=await tx.query.sellerRevenueEventTable.findFirst({where:eq(s.sellerRevenueEventTable.eventKey,key)});
    const fingerprint=JSON.stringify(input);
    if(existing) {if(existing.detail.fingerprint!==fingerprint) throw new CustomError("Idempotency conflict",409);return existing;}
    const sign=input.direction==="increase"?BigInt(1):-BigInt(1);
    return postRevenue(tx,{sellerId,eventKey:key,type:"adjustment",cash:units(input.cash)*sign,coinValue:units(input.coins)/BigInt(10)*sign,released:true,adjustment:true,actorAccountId:actorId,detail:{reason:input.reason,fingerprint}});
  });
}

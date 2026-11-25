import { and, count, desc, eq, SQL } from "drizzle-orm";
import * as s from "../db/schema";
import db from "../lib/initDB";
import { CustomError } from "../lib/error";
import { amount, units, UNIT } from "../lib/earningsMoney";
import { lockWalletIdempotencyKeyWithTx } from "./accountWallet";
import { earningsScope, lockRevenue, revenueState, sumLots, EarningsTx } from "./sellerEarnings";
import { getActiveAdminAccount } from "./adminScope";

type RequestRow=typeof s.sellerWalletRequestTable.$inferSelect;
export type RequestInput={wallet:"advertising"|"revenue";direction:"deposit"|"withdrawal";cash:string;coins:string;idempotencyKey:string;reason?:string};
export function validateRequestAmounts(input:Pick<RequestInput,"wallet"|"direction"|"cash"|"coins">) {
  const cash=units(input.cash),coins=units(input.coins);
  if(cash<BigInt(0)||coins<BigInt(0)||cash+coins<=BigInt(0)) throw new CustomError("Positive total required",400);
  if(input.wallet==="advertising"&&coins!==BigInt(0)) throw new CustomError("Advertising wallet uses cash only",400);
  if(input.direction==="deposit") {
    if(input.wallet!=="advertising"||cash%BigInt(10000)!==BigInt(0)) throw new CustomError("Deposits require advertising-wallet cash with at most two decimals",400);
  } else if(cash%UNIT!==BigInt(0)||coins%(BigInt(10)*UNIT)!==BigInt(0)) throw new CustomError("Withdraw whole TWD and multiples of ten coins",400);
}
export async function lockRequestWallet(tx:EarningsTx,sellerId:string,wallet:"advertising"|"revenue") {
  if(wallet==="revenue") return lockRevenue(tx,sellerId);
  const [row]=await tx.select().from(s.accountWalletTable).where(eq(s.accountWalletTable.accountId,sellerId)).for("update");
  if(!row) throw new CustomError("Wallet not initialized",409);
  return row;
}
async function requireAvailable(tx:EarningsTx,sellerId:string,input:RequestInput) {
  if(input.direction==="deposit")return;
  if(input.wallet==="advertising") {
    const [wallet]=await tx.select().from(s.accountWalletTable).where(eq(s.accountWalletTable.accountId,sellerId));
    if(units(wallet.walletBalance)-units(wallet.lockedBalance)<units(input.cash)) throw new CustomError("Insufficient available wallet balance",409);
    await tx.update(s.accountWalletTable).set({lockedBalance:amount(units(wallet.lockedBalance)+units(input.cash))}).where(eq(s.accountWalletTable.id,wallet.id));
  } else {
    const account=await lockRevenue(tx,sellerId);
    if(units(account.debt)>BigInt(0)) throw new CustomError("Outstanding seller debt blocks withdrawal",409);
    const {lots,requests}=await revenueState(tx,sellerId);
    const cash= sumLots(lots,"cash",true)-requests.reduce((n,r)=>n+units(r.cash),BigInt(0));
    const coin= sumLots(lots,"coinValue",true)-requests.reduce((n,r)=>n+units(r.coins)/BigInt(10),BigInt(0));
    if(units(input.cash)>cash||units(input.coins)/BigInt(10)>coin)throw new CustomError("Insufficient released balance",409);
  }
}
export async function createWalletRequest(actorId:string,input:RequestInput) {
  const actor=await getActiveAdminAccount(actorId);
  if(actor.role!=="seller")throw new CustomError("Only sellers can initiate wallet requests",403);
  validateRequestAmounts(input);
  return db.transaction(async tx=>{
    await lockWalletIdempotencyKeyWithTx(tx,`request:${actorId}:${input.idempotencyKey}`);
    await lockRequestWallet(tx,actorId,input.wallet);
    const key=`request:${actorId}:${input.idempotencyKey}`;
    const old=await tx.query.sellerWalletRequestTable.findFirst({where:eq(s.sellerWalletRequestTable.idempotencyKey,key)});
    if(old){if(old.wallet!==input.wallet||old.direction!==input.direction||units(old.requestedCash)!==units(input.cash)||units(old.requestedCoins)!==units(input.coins))throw new CustomError("Idempotency conflict",409);return old;}
    await requireAvailable(tx,actorId,input);
    const [row]=await tx.insert(s.sellerWalletRequestTable).values({sellerId:actorId,wallet:input.wallet,direction:input.direction,
      cash:input.cash,coins:input.coins,requestedCash:input.cash,requestedCoins:input.coins,idempotencyKey:key,reason:input.reason,
      history:[{status:"pending",at:new Date().toISOString(),actorId}]}).returning();return row;
  });
}
export async function reviewWalletRequest(actorId:string,id:string,input:{action:"processing"|"completed"|"cancelled"|"rejected";cash?:string;coins?:string;reason:string}) {
  const actor=await getActiveAdminAccount(actorId);
  const initial=await db.query.sellerWalletRequestTable.findFirst({where:eq(s.sellerWalletRequestTable.id,id)});
  if(!initial)throw new CustomError("Request not found",404);
  if(actor.role!=="admin"&&!(actor.role==="seller"&&actor.id===initial.sellerId&&input.action==="cancelled"))throw new CustomError("Administrator access required",403);
  return db.transaction(async tx=>{
    await lockRequestWallet(tx,initial.sellerId,initial.wallet);
    const [r]=await tx.select().from(s.sellerWalletRequestTable).where(eq(s.sellerWalletRequestTable.id,id)).for("update");
    const cash=input.cash??r.cash,coins=input.coins??r.coins;
    if(["completed","cancelled","rejected"].includes(r.status)){
      if(r.status===input.action&&units(cash)===units(r.cash)&&units(coins)===units(r.coins))return r;
      throw new CustomError("Request is terminal",409);
    }
    if(units(cash)>units(r.requestedCash)||units(coins)>units(r.requestedCoins)||units(cash)>units(r.cash)||units(coins)>units(r.coins))throw new CustomError("Review may only reduce amounts",400);
    validateRequestAmounts({...r,cash,coins});
    if(r.status==="processing"&&(input.action!=="completed"||units(cash)!==units(r.cash)||units(coins)!==units(r.coins)))throw new CustomError("Payment in progress cannot be amended or cancelled",409);
    if(r.direction==="withdrawal"&&input.action==="completed"&&r.status!=="processing")throw new CustomError("Start payment processing before completion",409);
    if(r.direction==="deposit"&&input.action==="processing")throw new CustomError("Deposits do not have a payment-processing state",400);
    if(input.action==="processing"&&r.wallet==="revenue") {
      const account=await lockRevenue(tx,r.sellerId);
      if(units(account.debt)>BigInt(0))throw new CustomError("Outstanding debt blocks payment",409);
    }
    if(r.wallet==="advertising") {
      const [wallet]=await tx.select().from(s.accountWalletTable).where(eq(s.accountWalletTable.accountId,r.sellerId));
      let locked=units(wallet.lockedBalance),balance=units(wallet.walletBalance);
      if(r.direction==="withdrawal") locked-=units(r.cash)-(input.action==="processing"?units(cash):BigInt(0));
      const completing=input.action==="completed";
      if(completing) balance+=units(cash)*(r.direction==="deposit"?BigInt(1):-BigInt(1));
      if(balance<BigInt(0)||locked<BigInt(0)||locked>balance)throw new CustomError("Invalid wallet reservation",409);
      await tx.update(s.accountWalletTable).set({walletBalance:amount(balance),lockedBalance:amount(locked)}).where(eq(s.accountWalletTable.id,wallet.id));
      if(completing)await tx.insert(s.accountWalletTransactionTable).values({walletId:wallet.id,accountId:r.sellerId,actorAccountId:actorId,type:r.direction==="deposit"?"seller_deposit":"seller_withdrawal",amount:amount(units(cash)*(r.direction==="deposit"?BigInt(1):-BigInt(1))),balanceBefore:wallet.walletBalance,balanceAfter:amount(balance),idempotencyKey:`wallet-request:${r.id}`,reason:input.reason,metadata:{requestId:r.id}});
    } else if(input.action==="completed") {
      const {lots}=await revenueState(tx,r.sellerId);
      for(const field of ["cash","coinValue"] as const) {
        let remaining=field==="cash"?units(cash):units(coins)/BigInt(10);
        for(const lot of lots.filter(l=>l.released)) {
          const available=units(lot[field]),take=available<remaining?available:remaining;
          await tx.update(s.sellerRevenueLotTable).set({[field]:amount(available-take)}).where(eq(s.sellerRevenueLotTable.id,lot.id));remaining-=take;if(!remaining)break;
        }
        if(remaining)throw new CustomError("Reserved funds unavailable",409);
      }
      const account=await lockRevenue(tx,r.sellerId);
      await tx.insert(s.sellerRevenueEventTable).values({sellerId:r.sellerId,eventKey:`withdrawal:${r.id}`,type:"withdrawal",cash:amount(-units(cash)),coinValue:amount(-units(coins)/BigInt(10)),debtAfter:account.debt,actorAccountId:actorId,detail:{requestId:r.id,reason:input.reason}});
    }
    if(r.wallet==="advertising"&&r.direction==="deposit"&&input.action==="completed") {
      const ads=await tx.select({id:s.advertisementTable.id}).from(s.advertisementTable).innerJoin(s.productTable,eq(s.productTable.id,s.advertisementTable.productId)).innerJoin(s.adAutoRefillTable,eq(s.adAutoRefillTable.advertisementId,s.advertisementTable.id)).where(and(eq(s.productTable.sellerId,r.sellerId),eq(s.adAutoRefillTable.enabled,true)));
      if(ads.length) await tx.insert(s.adRefillEventTable).values(ads.map(ad=>({advertisementId:ad.id}))).onConflictDoNothing();
    }
    const [updated]=await tx.update(s.sellerWalletRequestTable).set({cash,coins,status:input.action,reason:input.reason,actorAccountId:actorId,updatedAt:new Date(),history:[...r.history,{status:input.action,cash,coins,reason:input.reason,actorId,at:new Date().toISOString()}]}).where(eq(s.sellerWalletRequestTable.id,id)).returning();return updated;
  });
}
export async function listWalletRequests(actorId:string,input:{sellerId?:string;page?:number;limit?:number;status?:RequestRow["status"];wallet?:RequestRow["wallet"]}) {
  const actor = await getActiveAdminAccount(actorId);
  const sellerId = actor.role === "admin" && !input.sellerId
    ? undefined
    : await earningsScope(actorId, input.sellerId);
  const page = input.page ?? 1, limit = input.limit ?? 20;
  const conditions: SQL[] = [];
  if (sellerId) conditions.push(eq(s.sellerWalletRequestTable.sellerId, sellerId));
  if (input.status) conditions.push(eq(s.sellerWalletRequestTable.status, input.status));
  if (input.wallet) conditions.push(eq(s.sellerWalletRequestTable.wallet, input.wallet));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [requests,[total]]=await Promise.all([db.select().from(s.sellerWalletRequestTable).where(where).orderBy(desc(s.sellerWalletRequestTable.createdAt),desc(s.sellerWalletRequestTable.id)).limit(limit).offset((page-1)*limit),db.select({n:count()}).from(s.sellerWalletRequestTable).where(where)]);
  return {requests,total:total.n,page,limit,totalPages:Math.ceil(total.n/limit)};
}

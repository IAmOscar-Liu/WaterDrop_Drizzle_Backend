import { canManageAdFunding } from "./utils/adPermissions";
import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import * as s from "../db/schema";
import db from "../lib/initDB";
import { CustomError } from "../lib/error";
import { moneyToMinorUnits, normalizeMoney } from "../lib/money";
import { depositAdBalance, setAdStatus } from "./advertisement";
import { getActiveAdminAccount } from "./adminScope";
import { lockWalletIdempotencyKeyWithTx } from "./accountWallet";

async function ownedAd(actorId:string,adId:string) {
  const actor=await getActiveAdminAccount(actorId);
  const [ad]=await db.select({id:s.advertisementTable.id,sellerId:s.productTable.sellerId}).from(s.advertisementTable).innerJoin(s.productTable,eq(s.productTable.id,s.advertisementTable.productId)).where(eq(s.advertisementTable.id,adId));
  if(!ad)throw new CustomError("Advertisement not found",404);
  if(actor.role==="employee"||(actor.role!=="admin"&&actor.id!==ad.sellerId))throw new CustomError("Only the owning seller or admin may operate this ad",403);
  return ad;
}
export async function batchFundAds(actorId:string,input:{items:Array<{advertisementId:string;amount:string}>;idempotencyKey:string}) {
  const items=input.items.map(i=>({...i,amount:normalizeMoney(i.amount)})).sort((a,b)=>a.advertisementId.localeCompare(b.advertisementId));
  const ads: Array<{id:string;sellerId:string}>=[];
  for(const i of items)ads.push(await ownedAd(actorId,i.advertisementId));
  if(new Set(ads.map(a=>a.sellerId)).size!==1)throw new CustomError("A batch must belong to one seller",400);
  return db.transaction(async tx=>{
    const key=`ad-batch:${actorId}:${input.idempotencyKey}`;
    await lockWalletIdempotencyKeyWithTx(tx,key);
    const fingerprint=JSON.stringify(items);
    const existing=await tx.query.adFundingBatchTable.findFirst({where:eq(s.adFundingBatchTable.key,key)});
    if(existing){if(existing.input!==fingerprint)throw new CustomError("Idempotency conflict",409);return existing.result;}
    // All debits share this wallet lock and transaction; a failure rolls back the entire batch.
    await tx.select().from(s.accountWalletTable).where(eq(s.accountWalletTable.accountId,ads[0].sellerId)).for("update");
    const results=[];
    for(const item of items) {
      try {results.push(await depositAdBalance({...item,requesterId:actorId,idempotencyKey:`${key}:${item.advertisementId}`,metadata:{source:"batch",batchKey:key}},tx));}
      catch(error){if(error instanceof CustomError)throw new CustomError(`Advertisement ${item.advertisementId}: ${error.message}; no batch funding was committed`,error.statusCode,error.code);throw error;}
    }
    await tx.insert(s.adFundingBatchTable).values({key,actorId,input:fingerprint,result:results});return results;
  });
}
export async function batchAdStatus(actorId:string,input:{advertisementIds:string[];status:"active"|"paused"}) {
  const results=[];
  for(const advertisementId of input.advertisementIds) {
    try{await ownedAd(actorId,advertisementId);const data=await setAdStatus(advertisementId,input.status,actorId);results.push({advertisementId,success:true,data});}
    catch(error){results.push({advertisementId,success:false,statusCode:error instanceof CustomError?error.statusCode:500,message:error instanceof Error?error.message:"Operation failed"});}
  }
  return results;
}
export async function getAutoRefill(actorId:string,adId:string) {
  await ownedAd(actorId,adId);
  return await db.query.adAutoRefillTable.findFirst({where:eq(s.adAutoRefillTable.advertisementId,adId)})??{advertisementId:adId,enabled:false,amount:"500.00",waitingSince:null,lastReason:null};
}
export async function setAutoRefill(actorId:string,adId:string,input:{enabled:boolean;amount?:string}) {
  await ownedAd(actorId,adId);
  const value=normalizeMoney(input.amount??"500");
  if(moneyToMinorUnits(value)>BigInt(Number.MAX_SAFE_INTEGER))throw new CustomError("Refill amount is too large",400);
  if(moneyToMinorUnits(value)<BigInt(10000))throw new CustomError("Refill amount must be at least NT$100",400);
  const actor = await getActiveAdminAccount(actorId);
  return db.transaction(async tx => {
    // Match automatic refill's setting -> stats lock order.
    await tx.select().from(s.adAutoRefillTable).where(eq(s.adAutoRefillTable.advertisementId,adId)).for("update");
    const [stats] = await tx.select().from(s.advertisementStatsTable).where(eq(s.advertisementStatsTable.advertisementId,adId)).for("update");
    const [state] = await tx.select({ad:s.advertisementTable,product:s.productTable,seller:s.accountTable})
      .from(s.advertisementTable)
      .innerJoin(s.productTable,eq(s.productTable.id,s.advertisementTable.productId))
      .innerJoin(s.accountTable,eq(s.accountTable.id,s.productTable.sellerId))
      .where(eq(s.advertisementTable.id,adId))
      .for("update", { of: s.productTable });
    if (!state) throw new CustomError("Advertisement not found",404);
    const allowed = canManageAdFunding(actor,state.ad,state.product,stats,state.seller);
    if (!allowed && (input.enabled || input.amount !== undefined)) {
      throw new CustomError("This advertisement cannot enable or change automatic refill; disabling without an amount is still allowed",409,"AD_AUTO_REFILL_NOT_ALLOWED");
    }
    const [row]=await tx.insert(s.adAutoRefillTable).values({advertisementId:adId,enabled:input.enabled,amount:value})
      .onConflictDoUpdate({target:s.adAutoRefillTable.advertisementId,set:{enabled:input.enabled,...(input.amount!==undefined?{amount:value}:{}),waitingSince:null,lastReason:null,updatedAt:new Date()}}).returning();
    if (row.enabled) await tx.insert(s.adRefillEventTable).values({advertisementId:adId}).onConflictDoNothing();
    else await tx.delete(s.adRefillEventTable).where(eq(s.adRefillEventTable.advertisementId,adId));
    return row;
  });
}
export async function attemptAutoRefill(adId:string) {
  return db.transaction(async tx=>{
    const [ad]=await tx.select({ad:s.advertisementTable,product:s.productTable,seller:s.accountTable}).from(s.advertisementTable)
      .innerJoin(s.productTable,eq(s.productTable.id,s.advertisementTable.productId)).innerJoin(s.accountTable,eq(s.accountTable.id,s.productTable.sellerId)).where(eq(s.advertisementTable.id,adId));
    if(!ad)return;
    // Same wallet -> stats lock order as manual funding. View debits are already committed.
    const [wallet]=await tx.select().from(s.accountWalletTable).where(eq(s.accountWalletTable.accountId,ad.seller.id)).for("update");
    const [setting]=await tx.select().from(s.adAutoRefillTable).where(eq(s.adAutoRefillTable.advertisementId,adId)).for("update");
    if(!setting?.enabled) { await tx.delete(s.adRefillEventTable).where(eq(s.adRefillEventTable.advertisementId,adId)); return; }
    const [stats]=await tx.select().from(s.advertisementStatsTable).where(eq(s.advertisementStatsTable.advertisementId,adId)).for("update");
    const [variant]=await tx.select({id:s.productVariantTable.id}).from(s.productVariantTable).where(and(eq(s.productVariantTable.productId,ad.product.id),eq(s.productVariantTable.status,"active"),sql`${s.productVariantTable.stock} > ${s.productVariantTable.reserve}`)).limit(1);
    let reason:string|null=null;
    if(!stats||!variant||!['active','depleted'].includes(stats.status)||ad.ad.archivedAt||ad.ad.financiallyClosedAt||ad.product.status!=="active"||ad.product.deletedAt||ad.seller.status!=="active"||ad.seller.deletedAt)reason="not_eligible";
    else if(stats.balance>=100)reason="balance_sufficient";
    else if(process.env.ACCOUNT_WALLET_AD_FUNDING_ENABLED!=="true")reason="funding_disabled";
    else if(!wallet||moneyToMinorUnits(wallet.walletBalance)-moneyToMinorUnits(wallet.lockedBalance)<moneyToMinorUnits(setting.amount))reason="insufficient_wallet_balance";
    if(reason){await tx.delete(s.adRefillEventTable).where(eq(s.adRefillEventTable.advertisementId,adId));await tx.update(s.adAutoRefillTable).set({lastReason:reason,waitingSince:reason==="insufficient_wallet_balance"?(setting.waitingSince??new Date()):null,updatedAt:new Date()}).where(eq(s.adAutoRefillTable.advertisementId,adId));return {reason};}
    const result=await depositAdBalance({advertisementId:adId,requesterId:ad.seller.id,amount:setting.amount,idempotencyKey:`auto-refill:${randomUUID()}`,metadata:{source:"automatic_refill",configuredAmount:setting.amount}},tx);
    await tx.update(s.adAutoRefillTable).set({lastReason:null,waitingSince:null,updatedAt:new Date()}).where(eq(s.adAutoRefillTable.advertisementId,adId));
    await tx.delete(s.adRefillEventTable).where(eq(s.adRefillEventTable.advertisementId,adId));
    return {reason:"funded",result};
  });
}
export async function retrySellerAutoRefills(sellerId:string) {
  const rows=await db.select({id:s.adAutoRefillTable.advertisementId}).from(s.adAutoRefillTable)
    .innerJoin(s.advertisementTable,eq(s.advertisementTable.id,s.adAutoRefillTable.advertisementId))
    .innerJoin(s.productTable,eq(s.productTable.id,s.advertisementTable.productId))
    .where(and(eq(s.productTable.sellerId,sellerId),eq(s.adAutoRefillTable.enabled,true)))
    .orderBy(sql`${s.adAutoRefillTable.waitingSince} asc nulls last`,asc(s.adAutoRefillTable.advertisementId));
  for(const row of rows)await attemptAutoRefill(row.id);
}

export async function recoverAutoRefillEvents() {
  // Recover the narrow crash window between a saved setting and its queued event as well.
  const enabled = await db.select({advertisementId:s.adAutoRefillTable.advertisementId}).from(s.adAutoRefillTable)
    .innerJoin(s.advertisementStatsTable,eq(s.advertisementStatsTable.advertisementId,s.adAutoRefillTable.advertisementId))
    .where(and(eq(s.adAutoRefillTable.enabled,true),sql`${s.advertisementStatsTable.balance} < 100`));
  if(enabled.length) await db.insert(s.adRefillEventTable).values(enabled).onConflictDoNothing();
  const pending=await db.select().from(s.adRefillEventTable).orderBy(asc(s.adRefillEventTable.createdAt));
  for (const event of pending) await attemptAutoRefill(event.advertisementId).catch(error => console.error("Auto-refill recovery failed", { advertisementId: event.advertisementId, error }));
}

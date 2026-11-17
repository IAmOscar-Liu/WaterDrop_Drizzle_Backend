import { swaggerSpec } from "../lib/swagger";
import "../lib/env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import db,{client} from "../lib/initDB";
import * as s from "../db/schema";
import { units, earningsHoldMs } from "../lib/earningsMoney";
import { adjustRevenue, earningsSummary, postPaidOrderRevenue, postRefundRevenue, releaseSellerEarnings } from "../repository/sellerEarnings";
import { createWalletRequest, reviewWalletRequest } from "../repository/walletRequest";
import { batchFundAds, attemptAutoRefill, setAutoRefill, retrySellerAutoRefills } from "../repository/adAutomation";
import { depositAdBalance, spendAdBalanceWithTx } from "../repository/advertisement";
import { listAdvertisementMetrics } from "../repository/advertisementReport";
import { shippingSummary, updateShippingClaim, reverseShippingSubsidy } from "../repository/shippingReimbursement";

async function main(){
  assert.equal(process.env.TEST_DATABASE_MANAGED,"true");
  const spec=swaggerSpec as any;
  assert.ok(spec.paths["/api/admin/seller-earnings/requests"].post);
  assert.ok(spec.paths["/api/admin/advertisement/{id}/auto-refill"].put);
  assert.ok(spec.components.schemas.RefundItem.properties.shippingReimbursement);

  process.env.SELLER_EARNINGS_LAUNCH_AT="2026-01-01T00:00:00Z";
  const env=process.env.NODE_ENV;
  process.env.NODE_ENV="development";assert.equal(earningsHoldMs(),33.6*3600_000);
  process.env.NODE_ENV="local";assert.equal(earningsHoldMs(),33.6*3600_000);
  process.env.NODE_ENV="stg";assert.equal(earningsHoldMs(),336*3600_000);process.env.NODE_ENV=env;
  const [seller,admin,other]=await db.insert(s.accountTable).values((["seller","admin","seller"] as const).map(role=>({role,email:`${randomUUID()}@test.invalid`,password:"unused",realName:"test",phone:"0900000000",profileCompletedAt:new Date(),emailVerifiedAt:new Date()}))).returning();
  await db.insert(s.accountWalletTable).values({accountId:seller.id});
  const [product]=await db.insert(s.productTable).values({sellerId:seller.id,name:"test",description:"test"}).returning();
  const [variant]=await db.insert(s.productVariantTable).values({productId:product.id,price:1000,stock:10}).returning();
  const ads=await db.insert(s.advertisementTable).values([1,2].map(i=>({productId:product.id,title:`ad${i}`,video_url:"https://example.test/a.mp4"}))).returning();
  await db.insert(s.advertisementStatsTable).values(ads.map(ad=>({advertisementId:ad.id,balance:0,status:"depleted" as const})));
  const deposit=await createWalletRequest(seller.id,{wallet:"advertising",direction:"deposit",cash:"2000",coins:"0",idempotencyKey:"deposit-request-1"});
  assert.equal((await db.query.accountWalletTable.findFirst({where:eq(s.accountWalletTable.accountId,seller.id)}))!.walletBalance,"0.00");
  await assert.rejects(reviewWalletRequest(admin.id,deposit.id,{action:"completed",cash:"2001",reason:"no"}),/reduce/);
  await reviewWalletRequest(admin.id,deposit.id,{action:"completed",cash:"1500",reason:"bank checked"});
  await reviewWalletRequest(admin.id,deposit.id,{action:"completed",cash:"1500",reason:"bank checked"});
  const reserved=await createWalletRequest(seller.id,{wallet:"advertising",direction:"withdrawal",cash:"1000",coins:"0",idempotencyKey:"cash-withdrawal-1"});
  await assert.rejects(depositAdBalance({advertisementId:ads[0].id,requesterId:seller.id,amount:"600",idempotencyKey:"cannot-spend-reserved"}),/Insufficient/);
  await assert.rejects(batchFundAds(seller.id,{items:ads.map(ad=>({advertisementId:ad.id,amount:"300"})),idempotencyKey:"batch-too-much"}),/no batch funding/);
  assert.equal((await db.query.advertisementStatsTable.findFirst({where:eq(s.advertisementStatsTable.advertisementId,ads[0].id)}))!.balance,0);
  await reviewWalletRequest(seller.id,reserved.id,{action:"cancelled",reason:"cancel"});
  const batch={items:ads.map(ad=>({advertisementId:ad.id,amount:"200"})),idempotencyKey:"batch-valid-1"};
  await Promise.all([batchFundAds(seller.id,batch),batchFundAds(seller.id,batch)]);
  assert.equal((await db.query.accountWalletTable.findFirst({where:eq(s.accountWalletTable.accountId,seller.id)}))!.walletBalance,"1100.00");
  await assert.rejects(setAutoRefill(other.id,ads[0].id,{enabled:true}),/owning/);
  await setAutoRefill(seller.id,ads[0].id,{enabled:true});
  await db.update(s.advertisementStatsTable).set({balance:99,status:"depleted"}).where(eq(s.advertisementStatsTable.advertisementId,ads[0].id));
  await Promise.all([attemptAutoRefill(ads[0].id),attemptAutoRefill(ads[0].id)]);
  assert.equal((await db.query.advertisementStatsTable.findFirst({where:eq(s.advertisementStatsTable.advertisementId,ads[0].id)}))!.balance,599);
  await db.update(s.advertisementStatsTable).set({balance:100}).where(eq(s.advertisementStatsTable.advertisementId,ads[0].id));
  await attemptAutoRefill(ads[0].id);
  assert.equal((await db.query.accountWalletTable.findFirst({where:eq(s.accountWalletTable.accountId,seller.id)}))!.walletBalance,"600.00");
  await db.update(s.advertisementStatsTable).set({balance:101,status:"paused"}).where(eq(s.advertisementStatsTable.advertisementId,ads[0].id));
  await db.transaction(tx=>spendAdBalanceWithTx(tx,{advertisementId:ads[0].id,amount:2,allowInactive:true}));
  assert.equal((await db.query.advertisementStatsTable.findFirst({where:eq(s.advertisementStatsTable.advertisementId,ads[0].id)}))!.status,"paused");
  await retrySellerAutoRefills(seller.id);
  assert.equal((await db.query.accountWalletTable.findFirst({where:eq(s.accountWalletTable.accountId,seller.id)}))!.walletBalance,"600.00");
  const metrics=await listAdvertisementMetrics({requesterId:seller.id});
  assert.equal(metrics.advertisements.find(a=>a.advertisement.id===ads[0].id)!.totalFundedAmount,"700.00");
  const [buyer]=await db.insert(s.userTable).values({email:`${randomUUID()}@test.invalid`,oauthProvider:"other",oauthId:randomUUID(),referralCode:randomUUID()}).returning();
  const confirmedAt=new Date("2026-11-01T19:00:00Z");
  const [order]=await db.insert(s.orderTable).values({userId:buyer.id,subTotal:1000,totalAmount:930,discountCoin:1000,orderStatus:"paid",completedAt:confirmedAt,shippingCost:30,shippingInfo:{nonCvsPickupGroup:[{LogisticsType:"home_delivery",products:[{productId:product.id,variantId:variant.id}],shippingCost:30,shippingCostDeduction:0}]}}).returning();
  const [item]=await db.insert(s.orderItemTable).values({orderId:order.id,productId:product.id,productVariantId:variant.id,quantity:1,unitPriceAtSale:1000,lineTotal:1000,productNameAtSale:"test"}).returning();
  await db.transaction(tx=>postPaidOrderRevenue(tx,order.id));await db.transaction(tx=>postPaidOrderRevenue(tx,order.id));
  let summary=await earningsSummary(seller.id);assert.equal(units(summary.cashBalance),units("840"));assert.equal(units(summary.coinBalance),units("900"));assert.equal(units(summary.pendingAmount),units("930"));
  await releaseSellerEarnings(new Date("2026-11-15T18:59:59Z"));summary=await earningsSummary(seller.id);assert.equal(units(summary.withdrawableAmount),BigInt(0));
  await releaseSellerEarnings(new Date("2026-11-15T19:00:00Z"));summary=await earningsSummary(seller.id);assert.equal(units(summary.withdrawableAmount),units("930"));
  const withdrawal=await createWalletRequest(seller.id,{wallet:"revenue",direction:"withdrawal",cash:"800",coins:"900",idempotencyKey:"revenue-withdrawal-1"});
  await assert.rejects(reviewWalletRequest(admin.id,withdrawal.id,{action:"processing",cash:"810",coins:"800",reason:"invalid mix"}),/reduce/);
  await reviewWalletRequest(admin.id,withdrawal.id,{action:"processing",cash:"700",coins:"800",reason:"approved reduction"});
  await assert.rejects(reviewWalletRequest(seller.id,withdrawal.id,{action:"cancelled",reason:"too late"}),/progress/);
  const [refund,second]=await db.insert(s.refundItemTable).values([1,2].map(()=>({orderItemId:item.id,quantity:1,refundAmount:1000,extraRefundAmount:30,reason:"test",status:"completed" as const}))).returning();
  const shipping=await shippingSummary(item.id,refund.id);assert.equal(shipping.buyerPaidAmount,"30.00");
  await db.transaction(tx=>updateShippingClaim(tx,refund,{reimburseOriginalShipping:true,otherExtraRefundAmount:0,status:"completed"}));
  await assert.rejects(db.transaction(tx=>updateShippingClaim(tx,second,{reimburseOriginalShipping:true,otherExtraRefundAmount:0,status:"completed"})),/already claimed/);
  await db.transaction(tx=>postRefundRevenue(tx,refund));await db.transaction(tx=>postRefundRevenue(tx,refund));
  summary=await earningsSummary(seller.id);assert.equal(units(summary.debt),units("780"));assert.equal(units(summary.reservedAmount),units("780"));
  await reviewWalletRequest(admin.id,withdrawal.id,{action:"completed",reason:"bank paid"});
  summary=await earningsSummary(seller.id);assert.equal(units(summary.cashBalance),BigInt(0));assert.equal(units(summary.coinBalance),BigInt(0));
  await adjustRevenue(admin.id,seller.id,{direction:"increase",cash:"900",coins:"0",reason:"correction",idempotencyKey:"adjust-credit-1"});
  summary=await earningsSummary(seller.id);assert.equal(units(summary.debt),BigInt(0));assert.equal(units(summary.withdrawableAmount),units("120"));
  const pending=await createWalletRequest(seller.id,{wallet:"revenue",direction:"withdrawal",cash:"80",coins:"0",idempotencyKey:"pending-to-cancel"});
  await adjustRevenue(admin.id,seller.id,{direction:"decrease",cash:"60",coins:"0",reason:"return shipment",idempotencyKey:"adjust-debit-1"});
  assert.equal((await db.query.sellerWalletRequestTable.findFirst({where:eq(s.sellerWalletRequestTable.id,pending.id)}))!.status,"cancelled");
  await assert.rejects(earningsSummary(other.id,seller.id),/another seller/);
  // CVS subsidy is retained through refunds and reversed once only after all deliveries
  // are cancelled and an admin records external no-cost evidence.
  const [cvsOrder]=await db.insert(s.orderTable).values({userId:buyer.id,subTotal:1000,totalAmount:1000,orderStatus:"paid",completedAt:confirmedAt,shippingCost:0,shippingInfo:{cvsPickupGroup:[{LogisticsType:"CVS",LogisticsSubType:"FAMIC2C",products:[{productId:product.id,variantId:variant.id}],shippingCost:0,shippingCostDeduction:0}]}}).returning();
  const [cvsItem]=await db.insert(s.orderItemTable).values({orderId:cvsOrder.id,productId:product.id,productVariantId:variant.id,quantity:1,unitPriceAtSale:1000,lineTotal:1000,productNameAtSale:"CVS"}).returning();
  process.env.ECPAY_FAMIC2C_SHIPPING_FEE="69";
  await db.transaction(tx=>postPaidOrderRevenue(tx,cvsOrder.id));
  const [shipment]=await db.select().from(s.sellerShipmentSnapshotTable).where(eq(s.sellerShipmentSnapshotTable.orderId,cvsOrder.id));
  assert.equal(shipment.subsidy,"69.00");
  await assert.rejects(reverseShippingSubsidy(admin.id,seller.id,{shipmentId:shipment.id,evidence:"carrier confirms zero charge"}),/entire/);
  const [cancelled]=await db.insert(s.deliveryTable).values({orderId:cvsOrder.id,LogisticsType:"CVS",status:"cancelled",GoodsAmount:1000}).returning();
  await db.update(s.orderItemTable).set({deliveryId:cancelled.id}).where(eq(s.orderItemTable.id,cvsItem.id));
  const reversal=await reverseShippingSubsidy(admin.id,seller.id,{shipmentId:shipment.id,evidence:"carrier confirms zero charge"});
  assert.equal(reversal.cash,"69.000000");
  assert.equal((await reverseShippingSubsidy(admin.id,seller.id,{shipmentId:shipment.id,evidence:"retry"})).id,reversal.id);
  // Old sales and spoofed group shipping cannot produce extra earnings.
  const [legacy]=await db.insert(s.orderTable).values({userId:buyer.id,subTotal:1000,totalAmount:1000,orderStatus:"paid",completedAt:new Date("2025-01-01")}).returning();
  await db.insert(s.orderItemTable).values({orderId:legacy.id,productId:product.id,productVariantId:variant.id,quantity:1,unitPriceAtSale:1000,lineTotal:1000,productNameAtSale:"legacy"});
  await db.transaction(tx=>postPaidOrderRevenue(tx,legacy.id));
  assert.equal((await db.select().from(s.sellerSaleSnapshotTable)).length,2);
  const oldPeriod=await earningsSummary(seller.id,undefined,new Date("2025-01-01"),new Date("2025-12-31"));
  assert.equal(units(oldPeriod.cashEarnings),BigInt(0));
  const [tinyOrder]=await db.insert(s.orderTable).values({userId:buyer.id,subTotal:0.03,totalAmount:0.02,discountCoin:0.1,orderStatus:"paid",completedAt:confirmedAt}).returning();
  const tinyVariants=await db.insert(s.productVariantTable).values([1,2,3].map(()=>({productId:product.id,price:0.01,stock:1}))).returning();
  await db.insert(s.orderItemTable).values(tinyVariants.map(v=>({orderId:tinyOrder.id,productId:product.id,productVariantId:v.id,quantity:1,unitPriceAtSale:0.01,lineTotal:0.01,productNameAtSale:"rounding"})));
  await db.transaction(tx=>postPaidOrderRevenue(tx,tinyOrder.id));
  const tinySnapshots=await db.select().from(s.sellerRevenueEventTable);
  const tinyNet=tinySnapshots.filter(e=>e.type==="sale"&&e.detail.orderId===tinyOrder.id).reduce((n,e)=>n+units(e.cash)+units(e.coinValue),BigInt(0));
  assert.equal(tinyNet,units("0.027"),"Commission allocation must preserve the combined net value across coin/cash rounding");
  // Virtual groups omit shipping charges. They must not make a mixed order's
  // known CVS charge unknown, while missing physical charges still need review.
  for (const physical of ["none", "known", "unknown"] as const) {
    const [virtualVariant]=await db.insert(s.productVariantTable).values({productId:product.id,price:100,stock:1}).returning();
    const [shippingOrder]=await db.insert(s.orderTable).values({userId:buyer.id,subTotal:physical==="none"?100:200,totalAmount:physical==="none"?100:249,orderStatus:"paid",completedAt:confirmedAt,shippingCost:physical==="none"?0:49,shippingInfo:{
      nonCvsPickupGroup:[{LogisticsType:"virtual",products:[{variantId:virtualVariant.id}]}],
      cvsPickupGroup:physical==="none"?[]:[{LogisticsType:"CVS",LogisticsSubType:"FAMIC2C",products:[{variantId:variant.id}],...(physical==="known"?{shippingCost:49}:{})}],
    }}).returning();
    const [virtualItem]=await db.insert(s.orderItemTable).values({orderId:shippingOrder.id,productId:product.id,productVariantId:virtualVariant.id,quantity:1,unitPriceAtSale:100,lineTotal:100,productNameAtSale:"virtual"}).returning();
    if(physical!=="none")await db.insert(s.orderItemTable).values({orderId:shippingOrder.id,productId:product.id,productVariantId:variant.id,quantity:1,unitPriceAtSale:100,lineTotal:100,productNameAtSale:"physical"});
    await db.transaction(tx=>postPaidOrderRevenue(tx,shippingOrder.id));
    const shippingStatus=await shippingSummary(virtualItem.id,randomUUID());
    const orderWarnings=(await earningsSummary(seller.id)).accountingWarnings.filter(w=>w.orderId===shippingOrder.id);
    if(physical!=="unknown") {
      assert.equal(shippingStatus.buyerPaidAmount,"0.00");
      assert.equal(shippingStatus.status,"not_applicable");
      assert.equal(shippingStatus.canReimburse,false);
      assert.equal(orderWarnings.length,0);
    } else assert.ok(orderWarnings.length>0,"Unknown physical shipping must still require review");
    if(physical==="known") {
      const shipments=await db.select().from(s.sellerShipmentSnapshotTable).where(eq(s.sellerShipmentSnapshotTable.orderId,shippingOrder.id));
      assert.equal(shipments.find(row=>row.logisticsType==="CVS")!.subsidy,"20.00");
    }
  }
  console.log("Seller earnings, wallet requests and advertising automation tests passed");
}
main().then(()=>client.end()).catch(async error=>{console.error(error);await client.end();process.exitCode=1;});

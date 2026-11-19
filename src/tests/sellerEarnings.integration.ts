import { canManageAdFunding } from "../repository/utils/adPermissions";
import advertisementService from "../services/advertisement";
import { advertisementValidation } from "../middleware/admin/advertisement";
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
import { depositAdBalance, spendAdBalanceWithTx, listAdminAdvertisements, countAdminAdvertisementsByStatus, getAdvertisement } from "../repository/advertisement";
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
  const adList = await listAdminAdvertisements({ requesterId: seller.id });
  assert.equal(adList.total, 2);
  assert.equal((await getAdvertisement(ads[0].id, seller.id))!.autoRefill, true);
  assert.equal((await getAdvertisement(ads[1].id, seller.id))!.autoRefill, false);
  for (const ad of ads) {
    assert.equal((await getAdvertisement(ad.id, seller.id))!.autoRefillAmount, "500.00");
    assert.equal(adList.advertisements.find(item => item.id === ad.id)!.autoRefillAmount, "500.00");
  }
  await assert.rejects(getAdvertisement(ads[0].id, other.id), /another seller/);
  assert.equal(adList.advertisements.find(ad => ad.id === ads[0].id)!.autoRefill, true, "Paused ad still exposes its enabled setting");
  assert.equal(adList.advertisements.find(ad => ad.id === ads[1].id)!.autoRefill, false, "No setting defaults to false");
  assert.equal((await listAdminAdvertisements({ requesterId: other.id })).total, 0);
  const metrics=await listAdvertisementMetrics({requesterId:seller.id});
  assert.equal(metrics.advertisements.find(a=>a.advertisement.id===ads[0].id)!.totalFundedAmount,"700.00");
  // Matching filters and timestamp ties must not put different ads on each page.
  const [filterSeller] = await db.insert(s.accountTable).values({
    role: "seller", email: `${randomUUID()}@test.invalid`, password: "unused",
    realName: "filter test", phone: "0900000000", profileCompletedAt: new Date(), emailVerifiedAt: new Date(),
  }).returning();
  const filterProducts = await db.insert(s.productTable).values([
    { sellerId: filterSeller.id, name: "product-only match", description: "test", status: "active" as const },
    { sellerId: filterSeller.id, name: "inactive product", description: "test", status: "inactive" as const },
  ]).returning();
  const tiedTime = new Date("2026-01-01T00:00:00Z");
  const alignmentAds = await db.insert(s.advertisementTable).values([
    { productId: filterProducts[0].id, title: "literal %_\\ token", video_url: "https://example.test/a.mp4", createdAt: tiedTime },
    { productId: filterProducts[0].id, title: "literal abc token", video_url: "https://example.test/a.mp4", createdAt: tiedTime },
    { productId: filterProducts[0].id, title: "paused title", video_url: "https://example.test/a.mp4", createdAt: tiedTime },
    { productId: filterProducts[1].id, title: "literal %_\\ token", video_url: "https://example.test/a.mp4", createdAt: tiedTime },
  ]).returning();
  await db.insert(s.advertisementStatsTable).values(alignmentAds.map((ad, i) => ({
    advertisementId: ad.id, status: i === 2 ? "paused" as const : "active" as const, balance: 0,
  })));
  const filterCases = [
    { filter: {}, expected: alignmentAds },
    { filter: { productStatus: "active" as const }, expected: alignmentAds.slice(0, 3) },
    { filter: { productStatus: "inactive" as const }, expected: [alignmentAds[3]] },
    { filter: { search: "  PRODUCT-ONLY  " }, expected: alignmentAds.slice(0, 3) },
    { filter: { search: "%_\\" }, expected: [alignmentAds[0], alignmentAds[3]] },
    { filter: { productStatus: "active" as const, status: "active" as const, search: "literal" }, expected: alignmentAds.slice(0, 2) },
    { filter: { search: "   " }, expected: alignmentAds },
    { filter: { search: "not present" }, expected: [] },
  ];
  for (const { filter, expected } of filterCases) {
    const expectedIds = expected.map(ad => ad.id).sort().reverse();
    for (const requester of [{ requesterId: filterSeller.id }, { requesterId: admin.id, sellerId: filterSeller.id }]) {
      const { status: _selectedStatus, ...countFilters } = filter;
      const counts = await countAdminAdvertisementsByStatus({ ...requester, ...countFilters });
      for (const tab of ["all", "active", "paused", "depleted", "archived"] as const) {
        const list = await listAdminAdvertisements({ ...requester, ...countFilters, limit: 1, ...(tab === "all" ? {} : { status: tab }) });
        assert.equal(counts[tab], list.total, `Count for ${tab} must match the filtered list total`);
      }
      assert.equal(counts.all, counts.active + counts.paused + counts.depleted + counts.archived);
      for (const page of [1, 2, 3]) {
        const input = { ...requester, ...filter, page, limit: 2 };
        const [list, report] = await Promise.all([listAdminAdvertisements(input), listAdvertisementMetrics(input)]);
        const ids = expectedIds.slice((page - 1) * 2, page * 2);
        assert.deepEqual(list.advertisements.map(ad => ad.id), ids);
        assert.deepEqual(report.advertisements.map(row => row.advertisement.id), ids);
        assert.equal(list.total, expectedIds.length);
        assert.equal(report.total, list.total);
        assert.equal(report.totalPages, list.totalPages);
      }
    }
  }
  assert.equal((await listAdvertisementMetrics({ requesterId: other.id, search: "literal" })).total, 0);
  assert.equal(advertisementValidation.metricsQuery.parse({ search: "  hello  ", productStatus: "active" }).search, "hello");
  for (const name of ["productStatus", "search"]) {
    assert.ok(spec.paths["/api/admin/advertisement/metrics"].get.parameters.some((parameter: any) => parameter.name === name));
  }
  for (const query of [{ productStatus: "all" }, { search: "a".repeat(201) }, { search: ["a", "b"] }]) {
    assert.equal(advertisementValidation.metricsQuery.safeParse(query).success, false);
  }
  assert.deepEqual(await countAdminAdvertisementsByStatus({ requesterId: other.id }), { all: 0, active: 0, paused: 0, depleted: 0, archived: 0 });
  await assert.rejects(countAdminAdvertisementsByStatus({ requesterId: other.id, sellerId: filterSeller.id }), /another seller/);
  const platformCounts = await countAdminAdvertisementsByStatus({ requesterId: admin.id });
  assert.equal(platformCounts.all, (await listAdminAdvertisements({ requesterId: admin.id, limit: 1 })).total);
  assert.equal(advertisementValidation.statusCountsQuery.parse({ search: "  hello  ", productStatus: "active" }).search, "hello");
  for (const query of [{ status: "active" }, { page: 1 }, { limit: 20 }, { productStatus: "all" }, { search: "a".repeat(201) }, { search: ["a", "b"] }, { sellerId: "invalid" }]) {
    assert.equal(advertisementValidation.statusCountsQuery.safeParse(query).success, false);
  }
  assert.deepEqual(spec.paths["/api/admin/advertisement/status-counts"].get.parameters.map((p: any) => p.name), ["sellerId", "productStatus", "search"]);
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
  assert.ok(spec.paths["/api/admin/advertisement/batch/auto-refill"].put);
  const batchSchema = advertisementValidation.batchAutoRefillBody;
  assert.equal(batchSchema.safeParse({ advertisementIds: [], enabled: true }).success, false);
  assert.equal(batchSchema.safeParse({ advertisementIds: [ads[0].id, ads[0].id], enabled: true }).success, false);
  for (const value of ["99.99", "90071992547409.92", "100.001"]) {
    assert.equal(batchSchema.safeParse({ advertisementIds: [ads[0].id], enabled: true, amount: value }).success, false);
  }
  assert.equal(batchSchema.safeParse({ advertisementIds: [ads[0].id], enabled: true, amount: "90071992547409.91" }).success, true);
  const settingsAds = await db.insert(s.advertisementTable).values([1,2].map(i=>({productId:product.id,title:`batch-settings-${i}`,video_url:"https://example.test/a.mp4"}))).returning();
  await db.insert(s.advertisementStatsTable).values(settingsAds.map(ad=>({advertisementId:ad.id,balance:0,status:"depleted" as const})));
  const defaultSettings = await advertisementService.batchAutoRefill(seller.id,{advertisementIds:settingsAds.map(a=>a.id),enabled:false});
  assert.ok(defaultSettings.data.every(r=>r.success));
  for (const ad of settingsAds) assert.equal((await db.query.adAutoRefillTable.findFirst({where:eq(s.adAutoRefillTable.advertisementId,ad.id)}))!.amount,"500.00");
  const configured = await advertisementService.batchAutoRefill(seller.id,{advertisementIds:[settingsAds[0].id,randomUUID(),settingsAds[1].id],enabled:true,amount:"100"});
  assert.deepEqual(configured.data.map(r=>r.success),[true,false,true]);
  for (const ad of settingsAds) assert.equal((await db.query.advertisementStatsTable.findFirst({where:eq(s.advertisementStatsTable.advertisementId,ad.id)}))!.balance,100);
  await advertisementService.batchAutoRefill(seller.id,{advertisementIds:settingsAds.map(a=>a.id),enabled:true,amount:"100"});
  for (const ad of settingsAds) assert.equal((await db.query.advertisementStatsTable.findFirst({where:eq(s.advertisementStatsTable.advertisementId,ad.id)}))!.balance,100,"Repeat configuration does not refill an adequate balance");
  const denied = await advertisementService.batchAutoRefill(other.id,{advertisementIds:settingsAds.map(a=>a.id),enabled:false});
  assert.ok(denied.data.every(r=>!r.success));
  const disabled = await advertisementService.batchAutoRefill(admin.id,{advertisementIds:settingsAds.map(a=>a.id),enabled:false});
  assert.ok(disabled.data.every(r=>r.success));
  const disabledList = await listAdminAdvertisements({ requesterId: admin.id, sellerId: seller.id });
  assert.ok(disabledList.advertisements.filter(ad => settingsAds.some(a => a.id === ad.id)).every(ad => ad.autoRefill === false));
  for (const ad of settingsAds) {
    const setting = (await db.query.adAutoRefillTable.findFirst({where:eq(s.adAutoRefillTable.advertisementId,ad.id)}))!;
    assert.equal((await getAdvertisement(ad.id, admin.id))!.autoRefill, false);
    assert.equal((await getAdvertisement(ad.id, admin.id))!.autoRefillAmount, "100.00");
    assert.equal(disabledList.advertisements.find(item => item.id === ad.id)!.autoRefillAmount, "100.00");
    assert.equal(setting.enabled,false); assert.equal(setting.amount,"100.00","Omitted amount preserves prior configuration");
  }
  for (const value of ["active", "inactive"]) {
    assert.equal(advertisementValidation.listQuery.safeParse({productStatus:value}).success, true);
  }
  for (const value of ["all", "archived", "", ["active", "inactive"]]) {
    assert.equal(advertisementValidation.listQuery.safeParse({productStatus:value}).success, false);
  }
  const [inactiveProduct] = await db.insert(s.productTable).values({sellerId:seller.id,name:"inactive filter fixture",description:"test",status:"inactive",deletedAt:new Date()}).returning();
  const filterAds = await db.insert(s.advertisementTable).values([1,2,3].map(i=>({productId:inactiveProduct.id,title:`filter-${i}`,video_url:"https://example.test/a.mp4"}))).returning();
  await db.insert(s.advertisementStatsTable).values(filterAds.map((ad,i)=>({advertisementId:ad.id,status:i===2?"archived" as const:"active" as const})));
  const filtered = await listAdminAdvertisements({requesterId:seller.id,status:"active",productStatus:"inactive",limit:1});
  assert.equal(filtered.total,2);
  assert.equal(filtered.totalPages,2);
  assert.equal(filtered.advertisements.length,1);
  assert.equal(filtered.advertisements[0].product!.status,"inactive");
  assert.ok(filtered.advertisements[0].product!.deletedAt, "Soft-deleted products remain queryable");
  const nextPage = await listAdminAdvertisements({requesterId:seller.id,status:"active",productStatus:"inactive",limit:1,page:2});
  assert.equal(nextPage.total,2);
  assert.notEqual(nextPage.advertisements[0].id,filtered.advertisements[0].id);
  assert.equal((await listAdminAdvertisements({requesterId:seller.id,productStatus:"inactive"})).total,3);
  const archivedFiltered = await listAdminAdvertisements({requesterId:admin.id,sellerId:seller.id,status:"archived",productStatus:"inactive"});
  assert.equal(archivedFiltered.total,1);
  assert.equal(archivedFiltered.advertisements[0].id,filterAds[2].id);
  const activeProducts = await listAdminAdvertisements({requesterId:seller.id,productStatus:"active"});
  assert.ok(activeProducts.total > 0);
  assert.ok(activeProducts.advertisements.every(ad=>ad.product!.status==="active"));
  assert.equal((await listAdminAdvertisements({requesterId:other.id,productStatus:"inactive"})).total,0);
  assert.ok(spec.paths["/api/admin/advertisement/list"].get.parameters.some((p:any)=>p.name==="productStatus"));
  assert.equal(advertisementValidation.listQuery.safeParse({search:"a".repeat(201)}).success,false);
  assert.equal(advertisementValidation.listQuery.safeParse({search:["one","two"]}).success,false);
  assert.equal(advertisementValidation.listQuery.parse({search:"  filter  "}).search,"filter");
  const searchPage = await listAdminAdvertisements({requesterId:seller.id,search:"  INACTIVE FILTER  ",status:"active",productStatus:"inactive",limit:1});
  assert.equal(searchPage.total,2);
  assert.equal(searchPage.totalPages,2);
  assert.equal(searchPage.advertisements.length,1);
  const searchNext = await listAdminAdvertisements({requesterId:seller.id,search:"inactive filter",status:"active",productStatus:"inactive",limit:1,page:2});
  assert.notEqual(searchPage.advertisements[0].id,searchNext.advertisements[0].id);
  const titleSearch = await listAdminAdvertisements({requesterId:admin.id,sellerId:seller.id,search:"FILTER-3"});
  assert.equal(titleSearch.total,1);
  assert.equal(titleSearch.advertisements[0].id,filterAds[2].id);
  assert.equal((await listAdminAdvertisements({requesterId:other.id,search:"filter"})).total,0);
  assert.equal((await listAdminAdvertisements({requesterId:seller.id,search:"no-such-ad-name"})).total,0);
  assert.equal((await listAdminAdvertisements({requesterId:seller.id,search:"   ",productStatus:"inactive"})).total,3);
  await db.update(s.advertisementTable).set({title:"literal 50%_offer"}).where(eq(s.advertisementTable.id,filterAds[0].id));
  assert.equal((await listAdminAdvertisements({requesterId:seller.id,search:"%_"})).total,1,"SQL wildcard characters are literal");
  assert.ok(spec.paths["/api/admin/advertisement/list"].get.parameters.some((p:any)=>p.name==="search"));
  const deletedProductCounts = await countAdminAdvertisementsByStatus({ requesterId: seller.id, productStatus: "inactive", search: "%_" });
  assert.deepEqual(deletedProductCounts, { all: 1, active: 1, paused: 0, depleted: 0, archived: 0 });
  // Permission hints and mutation guards share the same policy.
  const pausedAd = ads[0];
  assert.equal((await getAdvertisement(pausedAd.id,seller.id))!.allowFunding,true);
  assert.equal((await listAdminAdvertisements({requesterId:seller.id})).advertisements.find(a=>a.id===pausedAd.id)!.allowFunding,true);
  await setAutoRefill(seller.id,pausedAd.id,{enabled:true,amount:"600"});
  const pausedBalance = (await db.query.advertisementStatsTable.findFirst({where:eq(s.advertisementStatsTable.advertisementId,pausedAd.id)}))!.balance;
  assert.equal((await attemptAutoRefill(pausedAd.id))!.reason,"not_eligible");
  await depositAdBalance({advertisementId:pausedAd.id,requesterId:seller.id,amount:"1",idempotencyKey:randomUUID()});
  const pausedAfter = (await db.query.advertisementStatsTable.findFirst({where:eq(s.advertisementStatsTable.advertisementId,pausedAd.id)}))!;
  assert.equal(pausedAfter.status,"paused");
  assert.equal(pausedAfter.balance,pausedBalance+1);
  assert.equal(canManageAdFunding({id:seller.id,role:"employee"},{archivedAt:null,financiallyClosedAt:null},product,pausedAfter,seller),false);
  assert.equal(canManageAdFunding(other,{archivedAt:null,financiallyClosedAt:null},product,pausedAfter,seller),false);
  assert.equal((await getAdvertisement(filterAds[0].id,admin.id))!.allowFunding,false);
  assert.ok((await listAdminAdvertisements({requesterId:admin.id,sellerId:seller.id,productStatus:"inactive"})).advertisements.every(ad=>!ad.allowFunding));
  for (const actor of [seller,admin]) {
    await assert.rejects(setAutoRefill(actor.id,filterAds[0].id,{enabled:true}),e=>(e as any).code==="AD_AUTO_REFILL_NOT_ALLOWED");
    await assert.rejects(setAutoRefill(actor.id,filterAds[0].id,{enabled:false,amount:"700"}),e=>(e as any).code==="AD_AUTO_REFILL_NOT_ALLOWED");
    await setAutoRefill(actor.id,filterAds[0].id,{enabled:false});
  }
  const walletBeforeRejected = (await db.query.accountWalletTable.findFirst({where:eq(s.accountWalletTable.accountId,seller.id)}))!.walletBalance;
  await assert.rejects(depositAdBalance({advertisementId:filterAds[0].id,requesterId:admin.id,amount:"1",idempotencyKey:randomUUID()}),e=>(e as any).code==="AD_PRODUCT_NOT_ACTIVE");
  await assert.rejects(batchFundAds(seller.id,{items:[{advertisementId:pausedAd.id,amount:"1"},{advertisementId:filterAds[0].id,amount:"1"}],idempotencyKey:randomUUID()}),/no batch funding was committed/);
  assert.equal((await db.query.accountWalletTable.findFirst({where:eq(s.accountWalletTable.accountId,seller.id)}))!.walletBalance,walletBeforeRejected);
  const mixedSettings = await advertisementService.batchAutoRefill(seller.id,{advertisementIds:[pausedAd.id,filterAds[0].id],enabled:true});
  assert.deepEqual(mixedSettings.data.map(r=>r.success),[true,false]);
  await assert.rejects(setAutoRefill(other.id,filterAds[0].id,{enabled:false}),/owning/);
  // A previously enabled ad can still be disabled after its product is taken down.
  await db.update(s.productTable).set({status:"inactive"}).where(eq(s.productTable.id,product.id));
  assert.equal((await getAdvertisement(pausedAd.id,seller.id))!.autoRefill,true);
  assert.equal((await getAdvertisement(pausedAd.id,seller.id))!.allowFunding,false);
  await assert.rejects(setAutoRefill(seller.id,pausedAd.id,{enabled:true}),e=>(e as any).code==="AD_AUTO_REFILL_NOT_ALLOWED");
  await setAutoRefill(seller.id,pausedAd.id,{enabled:false});
  assert.equal((await getAdvertisement(pausedAd.id,seller.id))!.autoRefillAmount,"600.00");
  await db.update(s.productTable).set({status:"active",deletedAt:new Date()}).where(eq(s.productTable.id,product.id));
  assert.equal((await getAdvertisement(pausedAd.id,seller.id))!.allowFunding,false);
  await assert.rejects(depositAdBalance({advertisementId:pausedAd.id,requesterId:seller.id,amount:"1",idempotencyKey:randomUUID()}),e=>(e as any).code==="AD_PRODUCT_NOT_ACTIVE");
  await db.update(s.productTable).set({deletedAt:null}).where(eq(s.productTable.id,product.id));
  await db.update(s.advertisementStatsTable).set({status:"archived"}).where(eq(s.advertisementStatsTable.advertisementId,pausedAd.id));
  assert.equal((await getAdvertisement(pausedAd.id,seller.id))!.allowFunding,false);
  await assert.rejects(setAutoRefill(admin.id,pausedAd.id,{enabled:true}),e=>(e as any).code==="AD_AUTO_REFILL_NOT_ALLOWED");
  await setAutoRefill(seller.id,pausedAd.id,{enabled:false});
  await db.update(s.advertisementStatsTable).set({status:"active"}).where(eq(s.advertisementStatsTable.advertisementId,pausedAd.id));
  await db.update(s.advertisementTable).set({financiallyClosedAt:new Date()}).where(eq(s.advertisementTable.id,pausedAd.id));
  assert.equal((await getAdvertisement(pausedAd.id,admin.id))!.allowFunding,false);
  await assert.rejects(setAutoRefill(admin.id,pausedAd.id,{enabled:true}),e=>(e as any).code==="AD_AUTO_REFILL_NOT_ALLOWED");
  assert.equal(spec.components.schemas.ListAdvertisementsResponse.properties.advertisements.items.allOf[1].properties.allowFunding.type,"boolean");
  await assert.rejects(depositAdBalance({advertisementId:pausedAd.id,requesterId:admin.id,amount:"1",idempotencyKey:randomUUID()}),/Archived or financially closed/);
  await db.update(s.advertisementTable).set({financiallyClosedAt:null}).where(eq(s.advertisementTable.id,pausedAd.id));
  const [employee] = await db.insert(s.accountTable).values({role:"employee",email:`${randomUUID()}@test.invalid`,password:"unused",realName:"test",phone:"0900000000"}).returning();
  await assert.rejects(depositAdBalance({advertisementId:pausedAd.id,requesterId:employee.id,amount:"1",idempotencyKey:randomUUID()}),/Only the owning seller/);
  await assert.rejects(setAutoRefill(employee.id,pausedAd.id,{enabled:false}),/owning/);
  await assert.rejects(depositAdBalance({advertisementId:pausedAd.id,requesterId:other.id,amount:"1",idempotencyKey:randomUUID()}),/Only the owning seller/);
  await db.update(s.accountTable).set({deletedAt:new Date()}).where(eq(s.accountTable.id,seller.id));
  assert.equal((await getAdvertisement(pausedAd.id,admin.id))!.allowFunding,false);
  await assert.rejects(depositAdBalance({advertisementId:pausedAd.id,requesterId:admin.id,amount:"1",idempotencyKey:randomUUID()}),/active seller account/);
  await assert.rejects(depositAdBalance({advertisementId:pausedAd.id,requesterId:seller.id,amount:"1",idempotencyKey:randomUUID()}),/inactive or no longer available/);
  await db.update(s.accountTable).set({deletedAt:null}).where(eq(s.accountTable.id,seller.id));
  assert.equal((await getAdvertisement(pausedAd.id,seller.id))!.allowFunding,true);
  await assert.rejects(depositAdBalance({advertisementId:pausedAd.id,requesterId:seller.id,amount:"999999",idempotencyKey:randomUUID()}),/Insufficient seller wallet balance/);
  console.log("Seller earnings, wallet requests and advertising automation tests passed");
}
main().then(()=>client.end()).catch(async error=>{console.error(error);await client.end();process.exitCode=1;});

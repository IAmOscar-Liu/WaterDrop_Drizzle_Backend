import { and, eq, sql } from "drizzle-orm";
import * as s from "../db/schema";
import db from "../lib/initDB";
import { CustomError } from "../lib/error";
import { units, earningsHoldMs } from "../lib/earningsMoney";
import { EarningsTx, postRevenue } from "./sellerEarnings";

export async function snapshotShipments(tx:EarningsTx,order:typeof s.orderTable.$inferSelect) {
  const info=order.shippingInfo as {cvsPickupGroup?:Array<Record<string,any>>;nonCvsPickupGroup?:Array<Record<string,any>>}|null;
  // Virtual checkout groups omit shipping amounts because no parcel is sent.
  // Normalize only those omitted charges; physical shipments still require evidence.
  const groups=[...(info?.cvsPickupGroup??[]),...(info?.nonCvsPickupGroup??[])].map(group =>
    group.LogisticsType === "virtual"
      ? { ...group, shippingCost: group.shippingCost ?? 0, shippingCostDeduction: group.shippingCostDeduction ?? 0 }
      : group,
  );
  // Only attribute money that reconciles to the amount actually collected on the order.
  // Never multiply whole-order shipping by item/group count or trust an inflated group charge.
  const validCharge = (group: Record<string, any>) => {
    const cost = Number(group.shippingCost), deduction = Number(group.shippingCostDeduction ?? 0);
    return Number.isFinite(cost) && Number.isFinite(deduction) && cost >= 0 && deduction >= 0 && deduction <= cost
      && Number(cost.toFixed(2)) === cost && Number(deduction.toFixed(2)) === deduction;
  };
  const allKnown = groups.every(validCharge);
  const totalPaid = allKnown ? groups.reduce((n,g) => n + units((Number(g.shippingCost)-Number(g.shippingCostDeduction??0)).toFixed(2)), BigInt(0)) : null;
  const reconciled = totalPaid !== null && totalPaid === units(((order.shippingCost??0)-(order.shippingCostDeduction??0)).toFixed(2));
  const rows=await tx.select({item:s.orderItemTable,sellerId:s.productTable.sellerId}).from(s.orderItemTable).innerJoin(s.productTable,eq(s.productTable.id,s.orderItemTable.productId)).where(eq(s.orderItemTable.orderId,order.id));
  for(const [index,group] of groups.entries()) {
    const items=rows.filter(r=>Array.isArray(group.products)&&group.products.some((p:any)=>p.variantId===r.item.productVariantId));
    if(!items.length||new Set(items.map(i=>i.sellerId)).size!==1)continue;
    const key=`${order.id}:${index}`;
    if(await tx.query.sellerShipmentSnapshotTable.findFirst({where:eq(s.sellerShipmentSnapshotTable.sourceKey,key)}))continue;
    const type=String(group.LogisticsType??"CVS");
    const known=reconciled&&validCharge(group);
    const paid=known?Math.max(0,Number(group.shippingCost)-Number(group.shippingCostDeduction??0)):null;
    const env=process.env[`ECPAY_${String(group.LogisticsSubType??"").replace("CVS_","")}_SHIPPING_FEE`];
    const standard=type==="CVS"&&env!==undefined&&Number.isFinite(Number(env))?Number(env):null;
    const subsidy=standard!==null&&paid!==null?Math.max(0,standard-paid):0;
    await tx.insert(s.sellerShipmentSnapshotTable).values({sourceKey:key,orderId:order.id,sellerId:items[0].sellerId,orderItemIds:items.map(i=>i.item.id),buyerPaidAmount:paid===null?null:paid.toFixed(2),standardCost:standard===null?null:standard.toFixed(2),subsidy:subsidy.toFixed(2),logisticsType:type});
    if(type === "home_delivery" && paid !== null && paid > 0) {
      await postRevenue(tx,{sellerId:items[0].sellerId,eventKey:`home-shipping:${key}`,type:"shipping_credit",cash:units(paid.toFixed(2)),coinValue:BigInt(0),releaseAt:new Date(order.completedAt!.getTime()+earningsHoldMs()),at:order.completedAt!,detail:{shipmentKey:key,buyerPaidAmount:paid,commission:"0"}});
    }
    if(subsidy>0) {
      await postRevenue(tx,{sellerId:items[0].sellerId,eventKey:`shipping:${key}`,type:"shipping",cash:-units(subsidy.toFixed(2)),coinValue:BigInt(0),at:order.completedAt!,detail:{shipmentKey:key,standardCost:standard,buyerPaidAmount:paid}});
    }
  }
}
export async function shippingSummary(orderItemId:string,refundId:string) {
  const [shipment]=await db.select().from(s.sellerShipmentSnapshotTable).where(sql`${orderItemId}::uuid = any(${s.sellerShipmentSnapshotTable.orderItemIds})`);
  const [breakdown]=await db.select().from(s.refundShippingBreakdownTable).where(eq(s.refundShippingBreakdownTable.refundId,refundId));
  const known=shipment?.buyerPaidAmount!==null&&shipment?.buyerPaidAmount!==undefined;
  const status=!known?"needs_review":Number(shipment.buyerPaidAmount)===0?"not_applicable":shipment.claimCompleted?"refunded":shipment.claimedByRefundId?"reserved":"available";
  return {buyerPaidAmount:shipment?.buyerPaidAmount??null,status,canReimburse:known&&Number(shipment.buyerPaidAmount)>0&&!shipment.claimCompleted&&(!shipment.claimedByRefundId||shipment.claimedByRefundId===refundId),claimedByRefundId:shipment?.claimedByRefundId??null,shipmentId:shipment?.id??null,shippingAmount:breakdown?.shippingAmount??"0.00",otherAmount:breakdown?.otherAmount??null};
}
// Called while the refund/order is locked. Reservation is taken as soon as an explicit selection is saved.
export async function updateShippingClaim(tx:EarningsTx,refund:typeof s.refundItemTable.$inferSelect,input:{status?:string;reimburseOriginalShipping?:boolean;otherExtraRefundAmount?:number;extraRefundAmount?:number}) {
  const [shipment]=await tx.select().from(s.sellerShipmentSnapshotTable).where(sql`${refund.orderItemId}::uuid = any(${s.sellerShipmentSnapshotTable.orderItemIds})`).for("update");
  const [old]=await tx.select().from(s.refundShippingBreakdownTable).where(eq(s.refundShippingBreakdownTable.refundId,refund.id));
  if(["cancelled","rejected"].includes(input.status??"")) {
    if(shipment?.claimedByRefundId===refund.id&&!shipment.claimCompleted)await tx.update(s.sellerShipmentSnapshotTable).set({claimedByRefundId:null}).where(eq(s.sellerShipmentSnapshotTable.id,shipment.id));
    return;
  }
  const explicit=input.reimburseOriginalShipping!==undefined||input.otherExtraRefundAmount!==undefined;
  if(!explicit&&!old) {
    if((input.extraRefundAmount??refund.extraRefundAmount??0)>0&&shipment)throw new CustomError("Specify shipping reimbursement and other compensation separately",400,"SHIPPING_BREAKDOWN_REQUIRED");
    return;
  }
  if(input.extraRefundAmount!==undefined&&explicit)throw new CustomError("Use the shipping breakdown instead of extraRefundAmount",400);
  if(input.extraRefundAmount!==undefined&&old)throw new CustomError("Update the shipping breakdown instead of the total",400);
  const wants=input.reimburseOriginalShipping??(Number(old?.shippingAmount??0)>0);
  if(wants&&(!shipment||shipment.buyerPaidAmount===null))throw new CustomError("Original shipping requires review",409,"SHIPPING_REIMBURSEMENT_NEEDS_REVIEW");
  if(wants&&(Number(shipment!.buyerPaidAmount)<=0||(shipment!.claimedByRefundId&&shipment!.claimedByRefundId!==refund.id)||shipment!.claimCompleted))throw new CustomError("Original shipping already claimed or unavailable",409,"SHIPPING_REIMBURSEMENT_UNAVAILABLE");
  const shipping=wants?shipment!.buyerPaidAmount!:"0.00";
  const other=(input.otherExtraRefundAmount??Number(old?.otherAmount??0)).toFixed(2);
  if(shipment)await tx.update(s.sellerShipmentSnapshotTable).set({claimedByRefundId:wants?refund.id:shipment.claimedByRefundId===refund.id?null:shipment.claimedByRefundId,claimCompleted:wants&&input.status==="completed"?true:shipment.claimCompleted}).where(eq(s.sellerShipmentSnapshotTable.id,shipment.id));
  await tx.insert(s.refundShippingBreakdownTable).values({refundId:refund.id,shipmentId:shipment?.id,shippingAmount:shipping,otherAmount:other}).onConflictDoUpdate({target:s.refundShippingBreakdownTable.refundId,set:{shippingAmount:shipping,otherAmount:other}});
  input.extraRefundAmount=Number(shipping)+Number(other);
}

// An admin supplies external no-cost evidence; delivery cancellation alone never proves zero cost.
export async function reverseShippingSubsidy(actorId:string,sellerId:string,input:{shipmentId:string;evidence:string}) {
  const { earningsScope }=await import("./sellerEarnings");
  await earningsScope(actorId,sellerId,true);
  return db.transaction(async tx=>{
    const [shipment]=await tx.select().from(s.sellerShipmentSnapshotTable).where(and(eq(s.sellerShipmentSnapshotTable.id,input.shipmentId),eq(s.sellerShipmentSnapshotTable.sellerId,sellerId))).for("update");
    if(!shipment||shipment.logisticsType!=="CVS"||Number(shipment.subsidy)<=0)throw new CustomError("No recorded CVS subsidy to reverse",409);
    const eventKey=`shipping-reversal:${shipment.id}`;
    const prior=await tx.query.sellerRevenueEventTable.findFirst({where:eq(s.sellerRevenueEventTable.eventKey,eventKey)});
    if(prior)return prior;
    const items=await tx.select({itemId:s.orderItemTable.id,deliveryId:s.deliveryTable.id,status:s.deliveryTable.status}).from(s.orderItemTable).leftJoin(s.deliveryTable,eq(s.deliveryTable.id,s.orderItemTable.deliveryId)).where(sql`${s.orderItemTable.id} = any(ARRAY[${sql.join(shipment.orderItemIds.map(id=>sql`${id}::uuid`),sql`, `)}])`);
    if(items.length!==shipment.orderItemIds.length||items.some(r=>!r.deliveryId||r.status!=="cancelled"))throw new CustomError("The entire original shipment must be cancelled",409);
    const [originalLot]=await tx.select().from(s.sellerRevenueLotTable).where(eq(s.sellerRevenueLotTable.orderItemId,shipment.orderItemIds[0]));
    return postRevenue(tx,{sellerId,eventKey,type:"shipping_reversal",cash:units(shipment.subsidy),coinValue:BigInt(0),actorAccountId:actorId,
      releaseAt:originalLot?.releaseAt??new Date(),released:originalLot?.released??false,detail:{shipmentId:shipment.id,noCostEvidence:input.evidence,originalSubsidy:shipment.subsidy}});
  });
}

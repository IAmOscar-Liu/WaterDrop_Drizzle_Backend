import { captureReceipt, lockRefundOrder, ReceiptSource, AccountReceiptConfirmation } from "./refundWindow";
import { refundEligibility, isAwaitingPickup } from "../lib/refundEligibility";
import {
  and,
  count,
  eq,
  gte,
  inArray,
  isNotNull,
  like,
  lte,
  or,
  SQL,
} from "drizzle-orm";
import * as schema from "../db/schema";
import db from "../lib/initDB";
import { isAccountAdmin } from "./account";
import { CustomError } from "../lib/error";
import {
  HOME_DELIVERY_FEE,
  HOME_DELIVERY_REFRIG_FEE,
  OKMARTC2C_LOW_TMP_DELIVERY,
} from "../constants/delivery";
import { ECPAY_SHIPPING_FEE } from "../constants/ecpay";
import {
  compactConditions,
  getPagination,
  getTotalPages,
  PaginationParams,
} from "./utils/query";
import { minimumVariantPrice } from "./utils/product";
import { recordAdminActivityWithTx } from "./adminActivity";
import { requireNonEmployee, resolveAdminSellerScope } from "./adminScope";
import { publishDeliveryChatrooms } from "./orderChatroom";

type DeliveryItemWithProductVariant = schema.OrderItem & {
  product?: schema.Product | null;
  variant?: Pick<schema.ProductVariant, "images"> | null;
};

function withVariantAtSaleDisplay<T extends DeliveryItemWithProductVariant>(
  item: T,
) {
  const {
    product,
    variant,
    variantNameAtSale,
    variantSkuAtSale,
    variantOptionValuesAtSale,
    ...rest
  } = item;
  const productWithoutVariant = product
    ? (() => {
        const {
          variant: _productVariant,
          refundWindowDays: _legacyProductPolicy,
          ...productRest
        } = product as typeof product & { variant?: unknown };
        return productRest;
      })()
    : product;

  return {
    ...rest,
    product: productWithoutVariant,
    variantAtSale: {
      name: variantNameAtSale,
      sku: variantSkuAtSale,
      optionValues: variantOptionValuesAtSale,
      price: rest.unitPriceAtSale,
    },
    variantImage: variant?.images?.[0] ?? null,
  };
}

export async function createDelivery(
  deliveryData: schema.NewDelivery,
  products?: { productId: string; variantId: string }[],
  receiptSource?: ReceiptSource,
) {
  return db.transaction(async (tx) => {
    await lockRefundOrder(tx, deliveryData.orderId);
    const { receivedAt: _receivedAt, receiptEvidence: _evidence, ...safeData } = deliveryData;
    if (receiptSource && safeData.status === "delivered" && isAwaitingPickup({ ...safeData, LogisticsSubType: safeData.LogisticsSubType ?? null, RtnCode: safeData.RtnCode ?? null })) {
      safeData.status = "ready_for_pickup";
    }
    let [newDelivery] = await tx
      .insert(schema.deliveryTable)
      .values(safeData)
      .returning();


    if (products && products.length > 0) {
      if (
        products.some((product) => !product.productId || !product.variantId)
      ) {
        throw new CustomError("productId and variantId are required", 400);
      }

      const productVariantConditions = products.map((product) =>
        and(
          eq(schema.orderItemTable.productId, product.productId),
          eq(schema.orderItemTable.productVariantId, product.variantId),
        ),
      );

      await tx
        .update(schema.orderItemTable)
        .set({
          deliveryId: newDelivery.id,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.orderItemTable.orderId, newDelivery.orderId),
            or(...productVariantConditions),
          ),
        );
    }

    newDelivery = await captureReceipt(tx, newDelivery, receiptSource);
    if (newDelivery.RtnCode && newDelivery.RtnMsg) {
      await tx.insert(schema.deliveryLogTable).values({
        deliveryId: newDelivery.id,
        status: newDelivery.status,
        RtnCode: newDelivery.RtnCode,
        RtnMsg: newDelivery.RtnMsg,
      });
    }

    // Publish after item association and receipt/log writes so the event carries
    // the final delivery summary, in the same transaction as the delivery.
    await publishDeliveryChatrooms(tx, newDelivery);
    return newDelivery;
  });
}

export type DeliveryNotificationContext = {
  lastStatus?: schema.Delivery["status"];
  update: {
    status?: schema.Delivery["status"];
    RtnCode?: string | null;
    RtnMsg?: string | null;
  };
};

export async function updateDeliveryWithNotificationContext(
  deliveryId: string,
  updates: Omit<
    Partial<schema.NewDelivery>,
    "id" | "orderId" | "createdAt" | "updatedAt" | "receivedAt" | "receiptEvidence"
  >,
  actorAccountId?: string,
  receiptSource?: ReceiptSource,
) {
  const result = await db.transaction(async (tx) => {
    const reference = await tx.query.deliveryTable.findFirst({ columns: { orderId: true }, where: eq(schema.deliveryTable.id, deliveryId) });
    if (!reference) return null;
    await lockRefundOrder(tx, reference.orderId);
    const [existingDelivery] = await tx
      .select()
      .from(schema.deliveryTable)
      .where(eq(schema.deliveryTable.id, deliveryId))
      .for("update");

    if (!existingDelivery) return null;

    const manualDelivery = ["virtual", "home_delivery"].includes(existingDelivery.LogisticsType);
    const actor = manualDelivery && actorAccountId ? await requireNonEmployee(actorAccountId) : undefined;

    const items = actor ? await tx.select({ item: schema.orderItemTable, sellerId: schema.productTable.sellerId })
      .from(schema.orderItemTable).innerJoin(schema.productTable, eq(schema.productTable.id, schema.orderItemTable.productId))
      .where(eq(schema.orderItemTable.deliveryId, deliveryId)).orderBy(schema.orderItemTable.id).for("update") : [];
    if (actor?.role === "seller" && (!items.length || items.some(row => row.sellerId !== actor.id))) {
      throw new CustomError("Delivery not found", 404);
    }
    const latestLog = await tx.query.deliveryLogTable.findFirst({
      where: eq(schema.deliveryLogTable.deliveryId, deliveryId),
      orderBy: (logs, { desc }) => [desc(logs.createdAt)],
    });

    if (receiptSource && updates.status === "delivered" && isAwaitingPickup({ ...existingDelivery, ...updates })) {
      updates = { ...updates, status: "ready_for_pickup" };
    }
    const terminal = manualDelivery && (Boolean(existingDelivery.receivedAt) || existingDelivery.status === "delivered");
    const candidate = { ...existingDelivery, ...updates };
    const changesIdentity = (["LogisticsType", "LogisticsSubType", "AllPayLogisticsID"] as const)
      .some(field => updates[field] !== undefined && updates[field] !== existingDelivery[field]);
    const regressesReceipt = (updates.status !== undefined && updates.status !== "delivered") || changesIdentity;
    if (terminal && regressesReceipt) {
      if (!receiptSource) throw new CustomError("Completed virtual or home delivery cannot be reset", 409, "DELIVERY_TERMINAL");
      // Preserve completed manual fulfillment if an integration reports an older status.
      const { status: _status, RtnCode: _code, RtnMsg: _message, LogisticsType: _type,
        LogisticsSubType: _subtype, AllPayLogisticsID: _providerId, ...nonStatusUpdates } = updates;
      updates = nonStatusUpdates;
    }
    let confirmation: AccountReceiptConfirmation | undefined;
    if (actor && !receiptSource && updates.status === "delivered" && !existingDelivery.receivedAt) {
      if (candidate.LogisticsType !== existingDelivery.LogisticsType || candidate.AllPayLogisticsID) {
        throw new CustomError("Delivery does not match the seller-managed method", 409, "DELIVERY_CONFIRMATION_NOT_SUPPORTED");
      } else {
        if (!items.length || items.some(row => row.item.orderId !== existingDelivery.orderId)) {
          throw new CustomError("Delivery item associations require reconciliation", 409, "DELIVERY_ITEMS_REQUIRED");
        }
        const [order] = await tx.select().from(schema.orderTable).where(eq(schema.orderTable.id, existingDelivery.orderId)).for("update");
        if (!order || order.orderStatus !== "paid") throw new CustomError("Order must be paid before delivery", 409, "ORDER_NOT_PAID");
        const shipping = order.shippingInfo as { nonCvsPickupGroup?: Array<{ LogisticsType?: string; type?: string;
          products?: Array<{ productId: string; variantId: string }> }> } | null;
        const groups = Array.isArray(shipping?.nonCvsPickupGroup) ? shipping.nonCvsPickupGroup : [];
        const matchesCheckout = items.every(({ item }) => groups.some(group => {
          const method = group?.LogisticsType ?? group?.type;
          return (method === "HOME" ? "home_delivery" : method) === existingDelivery.LogisticsType
            && Array.isArray(group?.products) && group.products.some(product =>
              product?.productId === item.productId && product.variantId === item.productVariantId);
        }));
        if (!matchesCheckout) throw new CustomError("Delivery does not match checkout selection", 409, "DELIVERY_CONFIRMATION_NOT_SUPPORTED");
        if (!["pending", "shipped", "delivered"].includes(existingDelivery.status)) {
          throw new CustomError("Delivery cannot be completed from its current state", 409, "DELIVERY_NOT_CONFIRMABLE");
        }
        confirmation = { source: actor.role === "admin" ? "admin_confirmation" : "seller_confirmation",
          actorAccountId: actor.id, actorRole: actor.role === "admin" ? "admin" : "seller" };
      }
    }
    let [updatedDelivery] = await tx
      .update(schema.deliveryTable)
      .set({ ...updates, receivedAt: existingDelivery.receivedAt, receiptEvidence: existingDelivery.receiptEvidence, updatedAt: new Date() })
      .where(eq(schema.deliveryTable.id, deliveryId))
      .returning();

    updatedDelivery = await captureReceipt(tx, updatedDelivery, confirmation ?? receiptSource, existingDelivery);
    const receiptConfirmed = Boolean(confirmation && !existingDelivery.receivedAt && updatedDelivery.receivedAt);

    const shouldLog = receiptConfirmed ||
      (updates.status !== undefined && updates.status !== latestLog?.status) ||
      (updates.RtnCode !== undefined &&
        updates.RtnCode !== latestLog?.RtnCode) ||
      (updates.RtnMsg !== undefined && updates.RtnMsg !== latestLog?.RtnMsg);

    if (shouldLog) {
      await tx.insert(schema.deliveryLogTable).values({
        deliveryId: updatedDelivery.id,
        status:
          updates.status !== undefined
            ? updates.status
            : (latestLog?.status ?? updatedDelivery.status),
        RtnCode:
          updates.RtnCode !== undefined
            ? updates.RtnCode
            : (latestLog?.RtnCode ?? updatedDelivery.RtnCode),
        RtnMsg:
          updates.RtnMsg !== undefined
            ? updates.RtnMsg
            : (latestLog?.RtnMsg ?? updatedDelivery.RtnMsg),
      });

      const sellers = await tx
        .selectDistinct({ sellerId: schema.productTable.sellerId })
        .from(schema.orderItemTable)
        .innerJoin(
          schema.productTable,
          eq(schema.productTable.id, schema.orderItemTable.productId),
        )
        .where(eq(schema.orderItemTable.orderId, updatedDelivery.orderId));
      await Promise.all(
        sellers.map(({ sellerId }) =>
          recordAdminActivityWithTx(tx, {
            actorAccountId,
            sellerId,
            eventType: "delivery.status_changed",
            entityType: "delivery",
            entityId: deliveryId,
            metadata: {
              previousStatus: existingDelivery.status,
              status: updatedDelivery.status,
            },
          }),
        ),
      );
    }

    if (receiptConfirmed) {
      for (const sellerId of new Set(items.map(row => row.sellerId))) {
        await recordAdminActivityWithTx(tx, { actorAccountId: actor!.id, sellerId, eventType: "delivery.confirmed",
          entityType: "delivery", entityId: deliveryId, metadata: { previousStatus: existingDelivery.status, status: "delivered",
            receivedAt: updatedDelivery.receivedAt?.toISOString(), receiptEvidence: updatedDelivery.receiptEvidence } });
      }
    }
    const chatFields = ["merchantTradeNo", "LogisticsType", "LogisticsSubType", "status", "RtnCode", "RtnMsg"] as const;
    if (receiptConfirmed || chatFields.some((field) => existingDelivery[field] !== updatedDelivery[field])) {
      await publishDeliveryChatrooms(tx, updatedDelivery);
    }

    return { updatedDelivery, latestLog, shouldLog, previousStatus: manualDelivery ? existingDelivery.status : latestLog?.status };
  });

  if (!result) return null;

  const newDeliveryDetails = await getDeliveryById(result.updatedDelivery.id);
  return {
    delivery: newDeliveryDetails,
    notificationContext: result.shouldLog
      ? {
          lastStatus: result.previousStatus,
          update: {
            status: updates.status,
            RtnCode: updates.RtnCode,
            RtnMsg: updates.RtnMsg,
          },
        }
      : undefined,
  };
}

export async function updateDelivery(
  deliveryId: string,
  updates: Parameters<typeof updateDeliveryWithNotificationContext>[1],
) {
  const result = await updateDeliveryWithNotificationContext(
    deliveryId,
    updates,
  );

  return result?.delivery ?? null;
}

export async function getDeliveryById(deliveryId: string) {
  const delivery = await db.query.deliveryTable.findFirst({
    where: eq(schema.deliveryTable.id, deliveryId),
    with: {
      order: {
        with: {
          user: {
            columns: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      },
      items: {
        with: {
          product: {
            extras: (products) => ({
              price: minimumVariantPrice(products.id).as("price"),
            }),
          },
          variant: true,
          refundItems: {
            orderBy: (refundItems, { desc }) => [desc(refundItems.createdAt)],
          },
        },
      },
      logs: {
        orderBy: (logs, { desc }) => [desc(logs.createdAt)],
      },
    },
  });

  if (!delivery) {
    return delivery;
  }

  // Reuse the loaded delivery/order/refund relations instead of calling
  // refund.canRefund for each item and triggering duplicate queries.
  return {
    ...delivery,
    items: delivery.items.map((item) => {
      const itemWithVariantAtSale = withVariantAtSaleDisplay(item);

      return {
        ...itemWithVariantAtSale,
        ...refundEligibility(delivery.order.orderStatus, item, item.refundItems, new Date(), delivery.status, delivery.order.completedAt),
      };
    }),
  };
}

export async function getDeliveryByMerchantTradeNo(merchantTradeNo: string) {
  return db.query.deliveryTable.findFirst({
    where: eq(schema.deliveryTable.merchantTradeNo, merchantTradeNo),
  });
}

export interface ListAdminDeliveriesParams extends PaginationParams {
  accountId: string;
  merchantTradeNo?: string;
  logisticsType?: schema.Delivery["LogisticsType"];
  status?: schema.Delivery["status"];
  startDate?: Date;
  endDate?: Date;
}

export async function listAdminDeliveries({
  page = 1,
  limit = 10,
  accountId,
  merchantTradeNo,
  logisticsType,
  status,
  startDate,
  endDate,
}: ListAdminDeliveriesParams) {
  const pagination = getPagination(page, limit);
  const conditions: (SQL | undefined)[] = [];

  const scope = await resolveAdminSellerScope(accountId);
  if (scope.sellerId) {
    const sellerDeliveryIdsSubquery = db
      .selectDistinct({ deliveryId: schema.orderItemTable.deliveryId })
      .from(schema.orderItemTable)
      .innerJoin(
        schema.productTable,
        eq(schema.orderItemTable.productId, schema.productTable.id),
      )
      .where(
        and(
          eq(schema.productTable.sellerId, scope.sellerId),
          isNotNull(schema.orderItemTable.deliveryId),
        ),
      );
    conditions.push(
      inArray(schema.deliveryTable.id, sellerDeliveryIdsSubquery),
    );
  }

  const merchantTradeNoPrefix = merchantTradeNo?.trim();
  if (merchantTradeNoPrefix && merchantTradeNoPrefix.length >= 4) {
    conditions.push(
      like(schema.deliveryTable.merchantTradeNo, `${merchantTradeNoPrefix}%`),
    );
  }

  if (status) {
    conditions.push(eq(schema.deliveryTable.status, status));
  }
  if (logisticsType) {
    conditions.push(eq(schema.deliveryTable.LogisticsType, logisticsType));
  }
  if (startDate) {
    conditions.push(gte(schema.deliveryTable.createdAt, startDate));
  }
  if (endDate) {
    conditions.push(lte(schema.deliveryTable.createdAt, endDate));
  }

  const totalResult = await db
    .select({ total: count() })
    .from(schema.deliveryTable)
    .where(compactConditions(conditions));

  const total = totalResult[0].total;
  const totalPages = getTotalPages(total, pagination.limit);

  const deliveriesData = await db.query.deliveryTable.findMany({
    where: compactConditions(conditions),
    limit: pagination.limit,
    offset: pagination.offset,
    with: {
      items: {
        with: {
          variant: {
            columns: { images: true },
          },
        },
      },
      order: {
        with: {
          user: {
            columns: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      },
    },
    orderBy: (deliveries, { desc }) => [desc(deliveries.createdAt)],
  });
  const deliveries = deliveriesData.map((delivery) => ({
    ...delivery,
    items: delivery.items.map(withVariantAtSaleDisplay),
  }));

  return {
    deliveries,
    total,
    page: pagination.page,
    limit: pagination.limit,
    totalPages,
  };
}

export async function upsertShippingFee(
  accountId: string,
  data: Partial<Omit<schema.ShippingFee, "id" | "accountId">>,
) {
  if (Object.keys(data).length === 0)
    throw new CustomError("No data provided", 400);

  for (let key of Object.keys(data)) {
    if (typeof (data as any)[key] === "number" && (data as any)[key] < 0)
      throw new CustomError(`${key} must be a positive number`, 400);
  }

  if (data.homeDelivery && data.homeDelivery > HOME_DELIVERY_FEE)
    throw new CustomError(
      `homeDelivery cannot be greater than ${HOME_DELIVERY_FEE}`,
      400,
    );
  if (
    data.homeDeliveryRefrig &&
    data.homeDeliveryRefrig > HOME_DELIVERY_REFRIG_FEE
  )
    throw new CustomError(
      `homeDeliveryRefrig cannot be greater than ${HOME_DELIVERY_REFRIG_FEE}`,
      400,
    );
  if (
    data.OKMART_LOW_TMP_C2C &&
    data.OKMART_LOW_TMP_C2C > OKMARTC2C_LOW_TMP_DELIVERY
  )
    throw new CustomError(
      `OKMART_LOW_TMP_C2C cannot be greater than ${OKMARTC2C_LOW_TMP_DELIVERY}`,
      400,
    );
  if (data.FAMIC2C && data.FAMIC2C > ECPAY_SHIPPING_FEE.FAMIC2C)
    throw new CustomError(
      `FAMIC2C cannot be greater than ${ECPAY_SHIPPING_FEE.FAMIC2C}`,
      400,
    );
  if (data.UNIMARTC2C && data.UNIMARTC2C > ECPAY_SHIPPING_FEE.UNIMARTC2C)
    throw new CustomError(
      `UNIMARTC2C cannot be greater than ${ECPAY_SHIPPING_FEE.UNIMARTC2C}`,
      400,
    );
  if (data.HILIFEC2C && data.HILIFEC2C > ECPAY_SHIPPING_FEE.HILIFEC2C)
    throw new CustomError(
      `HILIFEC2C cannot be greater than ${ECPAY_SHIPPING_FEE.HILIFEC2C}`,
      400,
    );
  if (data.OKMARTC2C && data.OKMARTC2C > ECPAY_SHIPPING_FEE.OKMARTC2C)
    throw new CustomError(
      `OKMARTC2C cannot be greater than ${ECPAY_SHIPPING_FEE.OKMARTC2C}`,
      400,
    );

  const existing = await db.query.shippingFeeTable.findFirst({
    where: eq(schema.shippingFeeTable.accountId, accountId),
  });

  if (existing) {
    const [updated] = await db
      .update(schema.shippingFeeTable)
      .set({ ...existing, ...data })
      .where(eq(schema.shippingFeeTable.id, existing.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(schema.shippingFeeTable)
    .values({ accountId, ...data })
    .returning();
  return created;
}

export async function getShippingFeeByAccountIds(accountIds: string[]) {
  return db.query.shippingFeeTable.findMany({
    where: inArray(schema.shippingFeeTable.accountId, accountIds),
  });
}

export async function getShippingFee(accountId: string) {
  return db.query.shippingFeeTable.findFirst({
    where: eq(schema.shippingFeeTable.accountId, accountId),
  });
}

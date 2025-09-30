import { and, count, eq, inArray, sql } from "drizzle-orm";
import * as schema from "../db/schema";
import { CustomError } from "../lib/error";
import db from "../lib/initDB";
import { upsertCartItem } from "./cart";

export async function createOrder(
  orderData: schema.NewOrder,
  items: Array<Omit<schema.NewOrderItem, "orderId" | "lineTotal">>
) {
  return db.transaction(async (tx) => {
    const [newOrder] = await tx
      .insert(schema.orderTable)
      .values(orderData)
      .returning();

    console.log("New Order Created:", newOrder.id);

    await tx.insert(schema.orderItemTable).values(
      items.map((item) => ({
        ...item,
        orderId: newOrder.id,
        lineTotal: item.unitPriceAtSale * item.quantity,
      }))
    );

    return tx.query.orderTable.findFirst({
      where: eq(schema.orderTable.id, newOrder.id),
      with: {
        items: {
          with: {
            product: true,
          },
        },
      },
    });
  });
}

export async function updateOrderStatus(
  orderId: string,
  status: Exclude<schema.NewOrder["orderStatus"], undefined>,
  metadata?: schema.NewOrder["metadata"]
) {
  return db.transaction(async (tx) => {
    // First, get the order to access its items and user ID
    const order = await getOrderById(orderId);
    if (!order) throw new CustomError("Order not found", 404);

    // If the new status is "paid", remove the corresponding items from the cart
    if (status === "paid") {
      const promises: Promise<any>[] = [];
      if (order.items.length > 0) {
        for (let item of order.items) {
          promises.push(upsertCartItem(order.userId, item.productId, 0));
        }
      }
      if (order.discountCoin && order.discountCoin > 0) {
        // Deduct the used discount coins from the user's balance
        promises.push(
          tx
            .update(schema.userTable)
            .set({
              coins: sql`${schema.userTable.coins} - ${order.discountCoin}`,
            })
            .where(eq(schema.userTable.id, order.userId))
        );
      }
      await Promise.all(promises);
    }

    // Update the order status
    await tx
      .update(schema.orderTable)
      .set({ orderStatus: status, metadata })
      .where(eq(schema.orderTable.id, orderId));

    // Return the fully updated order with its relations
    return getOrderById(orderId);
  });
}

export interface ListOrdersParams {
  userId: string;
  page?: number;
  limit?: number;
  statusIn: Exclude<schema.NewOrder["orderStatus"], undefined>[];
  order?: "asc" | "desc";
}

export async function listOrders({
  page = 1,
  limit = 10,
  userId,
  statusIn,
  order = "desc",
}: ListOrdersParams) {
  const offset = (page - 1) * limit;

  // Query for total count
  const totalResult = await db
    .select({ total: count() })
    .from(schema.orderTable)
    .where(
      and(
        inArray(schema.orderTable.orderStatus, statusIn),
        eq(schema.orderTable.userId, userId)
      )
    );

  const total = totalResult[0].total;
  const totalPages = Math.ceil(total / limit);

  // Query for the paginated orders with their related items and products
  const orders = await db.query.orderTable.findMany({
    limit,
    offset,
    where: and(
      inArray(schema.orderTable.orderStatus, statusIn),
      eq(schema.orderTable.userId, userId)
    ),
    with: {
      items: {
        with: {
          product: true,
        },
      },
    },
    orderBy: (orders, { desc, asc }) => [
      order === "asc" ? asc(orders.createdAt) : desc(orders.createdAt),
    ],
  });

  return { orders, total, page, limit, totalPages };
}

export async function getOrderById(orderId: string) {
  return db.query.orderTable.findFirst({
    where: eq(schema.orderTable.id, orderId),
    with: {
      items: {
        with: {
          product: true,
        },
      },
    },
  });
}

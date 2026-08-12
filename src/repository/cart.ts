import { and, eq } from "drizzle-orm";
import * as schema from "../db/schema";
import db from "../lib/initDB";
import { CustomError } from "../lib/error";
import { withProductVariantAggregates } from "./product";

/**
 * Adds or updates an item in the user's cart.
 * If the quantity is 0 or less, the item is removed from the cart.
 * This operation is an "upsert" (update or insert).
 *
 * @param userId The ID of the user.
 * @param productId The ID of the product.
 * @param quantity The new quantity of the product.
 * @returns The upserted cart item, or undefined if the item was removed.
 */
export async function upsertCartItem(
  userId: string,
  productId: string,
  productVariantId: string,
  quantity: number,
) {
  return db.transaction(async (tx) => {
    const [variant] = await tx
      .select()
      .from(schema.productVariantTable)
      .where(eq(schema.productVariantTable.id, productVariantId))
      .for("update");

    if (!variant || variant.productId !== productId) {
      throw new CustomError("Product variant not found", 404);
    }

    if (variant.status !== "active") {
      throw new CustomError("Product variant is inactive", 400);
    }

    if (quantity > variant.stock - variant.reserve) {
      throw new CustomError("Insufficient stock", 400);
    }

    // If quantity is 0 or less, remove the item from the cart.
    if (quantity <= 0) {
      await tx
        .delete(schema.cartItemTable)
        .where(
          and(
            eq(schema.cartItemTable.userId, userId),
            eq(schema.cartItemTable.productVariantId, productVariantId),
          ),
        );
      return;
    }

    const existingCartItem = await tx.query.cartItemTable.findFirst({
      where: and(
        eq(schema.cartItemTable.userId, userId),
        eq(schema.cartItemTable.productVariantId, productVariantId),
      ),
    });

    if (existingCartItem) {
      const [updatedCartItem] = await tx
        .update(schema.cartItemTable)
        .set({ quantity, productId, updatedAt: new Date() })
        .where(eq(schema.cartItemTable.id, existingCartItem.id))
        .returning();

      return updatedCartItem;
    }

    const [insertedCartItem] = await tx
      .insert(schema.cartItemTable)
      .values({ userId, productId, productVariantId, quantity })
      .returning();

    return insertedCartItem;
  });
}

export async function toggleCartItem({
  userId,
  productId,
  productVariantId,
  checked,
}: {
  userId: string;
  productId: string;
  productVariantId: string;
  checked: boolean;
}) {
  return db.transaction(async (tx) => {
    const cartItem = await tx.query.cartItemTable.findFirst({
      where: and(
        eq(schema.cartItemTable.userId, userId),
        eq(schema.cartItemTable.productId, productId),
        eq(schema.cartItemTable.productVariantId, productVariantId),
      ),
    });

    if (!cartItem) {
      throw new CustomError("Cart item not found", 404);
    }

    const [updatedCartItem] = await tx
      .update(schema.cartItemTable)
      .set({ checked, updatedAt: new Date() })
      .where(eq(schema.cartItemTable.id, cartItem.id))
      .returning();
    return updatedCartItem;
  });
}

export async function updateCartItemVariant({
  userId,
  cartItemId,
  productVariantId,
}: {
  userId: string;
  cartItemId: string;
  productVariantId: string;
}) {
  return db.transaction(async (tx) => {
    const [cartItem] = await tx
      .select()
      .from(schema.cartItemTable)
      .where(
        and(
          eq(schema.cartItemTable.id, cartItemId),
          eq(schema.cartItemTable.userId, userId),
        ),
      )
      .for("update");

    if (!cartItem) {
      throw new CustomError("Cart item not found", 404);
    }

    if (cartItem.productVariantId === productVariantId) {
      return cartItem;
    }

    const [variant] = await tx
      .select()
      .from(schema.productVariantTable)
      .where(eq(schema.productVariantTable.id, productVariantId))
      .for("update");

    if (!variant || variant.productId !== cartItem.productId) {
      throw new CustomError("Product variant not found", 404);
    }

    if (variant.status !== "active") {
      throw new CustomError("Product variant is inactive", 400);
    }

    const [targetCartItem] = await tx
      .select()
      .from(schema.cartItemTable)
      .where(
        and(
          eq(schema.cartItemTable.userId, userId),
          eq(schema.cartItemTable.productId, cartItem.productId),
          eq(schema.cartItemTable.productVariantId, productVariantId),
        ),
      )
      .for("update");

    const nextQuantity = cartItem.quantity + (targetCartItem?.quantity ?? 0);
    if (nextQuantity > variant.stock - variant.reserve) {
      throw new CustomError("Insufficient stock", 400);
    }

    if (targetCartItem) {
      const [updatedCartItem] = await tx
        .update(schema.cartItemTable)
        .set({
          quantity: nextQuantity,
          checked: cartItem.checked || targetCartItem.checked,
          updatedAt: new Date(),
        })
        .where(eq(schema.cartItemTable.id, targetCartItem.id))
        .returning();

      await tx
        .delete(schema.cartItemTable)
        .where(eq(schema.cartItemTable.id, cartItem.id));

      return updatedCartItem;
    }

    const [updatedCartItem] = await tx
      .update(schema.cartItemTable)
      .set({ productVariantId, updatedAt: new Date() })
      .where(eq(schema.cartItemTable.id, cartItem.id))
      .returning();

    return updatedCartItem;
  });
}

/**
 * Lists all items in a user's cart, including product details.
 * The items are sorted by their creation date in descending order.
 *
 * @param userId The ID of the user.
 * @returns A promise that resolves to an array of cart items with their associated products.
 */
export async function listCartItems(userId: string) {
  const cartItems = await db.query.cartItemTable.findMany({
    where: eq(schema.cartItemTable.userId, userId),
    with: {
      product: {
        with: {
          seller: {
            columns: {
              role: true,
              name: true,
              realName: true,
              email: true,
              phone: true,
              avatar_url: true,
            },
          },
          productsToCategories: {
            with: {
              category: true,
            },
          },
          variants: {
            where: eq(schema.productVariantTable.status, "active"),
            orderBy: (variants, { asc }) => [asc(variants.sortOrder)],
          },
        },
      }, // Include the related product data
      variant: true,
    },
    orderBy: (cartItems, { desc }) => [desc(cartItems.createdAt)],
  });

  return cartItems.map((item) => ({
    ...item,
    product: item.product
      ? withProductVariantAggregates(item.product)
      : item.product,
    variant: item.variant
      ? {
          ...item.variant,
          availableStock: item.variant.stock - item.variant.reserve,
        }
      : item.variant,
  }));
}

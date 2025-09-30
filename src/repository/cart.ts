import { and, eq } from "drizzle-orm";
import * as schema from "../db/schema";
import db from "../lib/initDB";

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
  quantity: number
) {
  // If quantity is 0 or less, remove the item from the cart.
  if (quantity <= 0) {
    await db
      .delete(schema.cartItemTable)
      .where(
        and(
          eq(schema.cartItemTable.userId, userId),
          eq(schema.cartItemTable.productId, productId)
        )
      );
    console.log(`Removed product ${productId} from cart for user ${userId}.`);
    return;
  }

  // Otherwise, insert a new item or update the quantity if it already exists.
  const [upsertedItem] = await db
    .insert(schema.cartItemTable)
    .values({ userId, productId, quantity })
    .onConflictDoUpdate({
      target: [schema.cartItemTable.userId, schema.cartItemTable.productId],
      set: { quantity: quantity, updatedAt: new Date() },
    })
    .returning();

  console.log(
    `Upserted product ${productId} with quantity ${quantity} for user ${userId}.`
  );
  return upsertedItem;
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
      product: true, // Include the related product data
    },
    orderBy: (cartItems, { desc }) => [desc(cartItems.createdAt)],
  });

  console.log(`Found ${cartItems.length} items in cart for user ${userId}.`);
  return cartItems;
}

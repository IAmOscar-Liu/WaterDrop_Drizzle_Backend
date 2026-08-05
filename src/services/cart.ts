import { CustomError, handleServiceError } from "../lib/error";
import {
  listCartItems,
  upsertCartItem,
  toggleCartItem,
  updateCartItemVariant,
} from "../repository/cart";
import { ServiceResponse } from "../type/general";

class CartServices {
  async listCartItems(
    userId: string,
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof listCartItems>>>> {
    try {
      const cartItems = await listCartItems(userId);
      return { success: true, data: cartItems };
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async addToCart({
    userId,
    productId,
    productVariantId,
    quantity,
  }: {
    userId: string;
    productId: string;
    productVariantId: string;
    quantity: number;
  }): Promise<ServiceResponse<Awaited<ReturnType<typeof upsertCartItem>>>> {
    try {
      if (!productVariantId) {
        throw new CustomError("productVariantId is required", 400);
      }

      const cartItem = await upsertCartItem(
        userId,
        productId,
        productVariantId,
        quantity,
      );
      return { success: true, data: cartItem };
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async toggleCartItem({
    userId,
    productId,
    productVariantId,
    checked,
  }: {
    userId: string;
    productId: string;
    productVariantId: string;
    checked: boolean;
  }): Promise<ServiceResponse<Awaited<ReturnType<typeof toggleCartItem>>>> {
    try {
      if (!productVariantId) {
        throw new CustomError("productVariantId is required", 400);
      }

      const cartItem = await toggleCartItem({
        userId,
        productId,
        productVariantId,
        checked,
      });
      return { success: true, data: cartItem };
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async updateCartItemVariant({
    userId,
    cartItemId,
    productVariantId,
  }: {
    userId: string;
    cartItemId: string;
    productVariantId: string;
  }): Promise<
    ServiceResponse<Awaited<ReturnType<typeof updateCartItemVariant>>>
  > {
    try {
      if (!productVariantId) {
        throw new CustomError("productVariantId is required", 400);
      }

      const cartItem = await updateCartItemVariant({
        userId,
        cartItemId,
        productVariantId,
      });
      return { success: true, data: cartItem };
    } catch (error) {
      return handleServiceError(error);
    }
  }
}

export default new CartServices();

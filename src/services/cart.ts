import { handleServiceError } from "../lib/error";
import { listCartItems, upsertCartItem } from "../repository/cart";
import { ServiceResponse } from "../type/general";

class CartServices {
  async listCartItems(
    userId: string
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof listCartItems>>>> {
    try {
      const cartItems = await listCartItems(userId);
      if (cartItems) {
        return { success: true, data: cartItems };
      } else {
        return {
          success: false,
          statusCode: 404,
          message: "cart items not found",
        };
      }
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async addToCart({
    userId,
    productId,
    quantity,
  }: {
    userId: string;
    productId: string;
    quantity: number;
  }): Promise<ServiceResponse<Awaited<ReturnType<typeof upsertCartItem>>>> {
    try {
      const cartItem = await upsertCartItem(userId, productId, quantity);
      return { success: true, data: cartItem };
    } catch (error) {
      return handleServiceError(error);
    }
  }
}

export default new CartServices();

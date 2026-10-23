import { Response, Request } from "express";
import { sendJsonResponse } from "../lib/general";
import cartServices from "../services/cart";
import { RequestWithId } from "../type/request";

class CartController {
  async validateCheckout(req: RequestWithId, res: Response): Promise<any> {
    if (req.sessionId) {
      return res.status(403).json({ success: false, message: "App user required" });
    }
    const result = await cartServices.validateCheckout(req.userId ?? "", req.body.items);
    sendJsonResponse(res, result);
  }

  async addToCart(req: RequestWithId, res: Response): Promise<any> {
    const { productId, productVariantId, quantity } = req.body;
    const userId = req.userId ?? "";
    const result = await cartServices.addToCart({
      userId,
      productId,
      productVariantId,
      quantity,
    });
    sendJsonResponse(res, result);
  }

  async toggleCartItem(req: RequestWithId, res: Response): Promise<any> {
    const { productId, productVariantId, checked } = req.body;
    const result = await cartServices.toggleCartItem({
      userId: req.userId ?? "",
      productId,
      productVariantId,
      checked,
    });
    sendJsonResponse(res, result);
  }

  async updateCartItemVariant(
    req: RequestWithId,
    res: Response,
  ): Promise<any> {
    const { cartItemId } = req.params;
    const { productVariantId } = req.body;
    const result = await cartServices.updateCartItemVariant({
      userId: req.userId ?? "",
      cartItemId,
      productVariantId,
    });
    sendJsonResponse(res, result);
  }

  async listCartItems(req: RequestWithId, res: Response): Promise<any> {
    const userId = req.userId ?? "";
    const result = await cartServices.listCartItems(userId);
    sendJsonResponse(res, result);
  }
}

export default new CartController();

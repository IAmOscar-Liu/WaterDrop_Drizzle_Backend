import { Response } from "express";
import { sendJsonResponse } from "../lib/general";
import cartServices from "../services/cart";
import { RequestWithId } from "../type/request";

class CartController {
  async addToCart(req: RequestWithId, res: Response): Promise<any> {
    const { productId, quantity } = req.body;
    const userId = req.userId ?? "";
    const result = await cartServices.addToCart({
      userId,
      productId,
      quantity,
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

import { Request, Response } from "express";
import { sendJsonResponse } from "../lib/general";
import productService from "../services/product";

class ProductController {
  async listCategory(_: Request, res: Response): Promise<any> {
    const result = await productService.listCategory();
    sendJsonResponse(res, result);
  }

  async listProducts(req: Request, res: Response): Promise<any> {
    const { page, limit, categoryId, search, minPrice, maxPrice } = req.query;
    const result = await productService.listProducts({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      categoryId: categoryId ? String(categoryId) : undefined,
      search: search ? String(search) : undefined,
      minPrice: minPrice ? Number(minPrice) : undefined,
      maxPrice: maxPrice ? Number(maxPrice) : undefined,
    });
    sendJsonResponse(res, result);
  }

  async getProduct(req: Request, res: Response): Promise<any> {
    const { id } = req.params;
    const result = await productService.getProductById(id);
    sendJsonResponse(res, result);
  }
}

export default new ProductController();

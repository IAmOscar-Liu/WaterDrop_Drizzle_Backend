import { Request, Response } from "express";
import { sendJsonResponse } from "../lib/general";
import productService from "../services/product";
import { ListProductsParams } from "../repository/product";
import { RequestWithId } from "../type/request";

class ProductController {
  async listCategory(_: Request, res: Response): Promise<any> {
    const result = await productService.listCategory();
    sendJsonResponse(res, result);
  }

  async createCategory(req: Request, res: Response): Promise<any> {
    const categoryData = req.body;
    const result = await productService.createCategory(categoryData);
    sendJsonResponse(res, result);
  }

  async listProducts(req: Request, res: Response): Promise<any> {
    const { page, limit, categoryId, search, minPrice, maxPrice } = req.query;
    const result = await productService.listProducts({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      categoryId: categoryId ? String(categoryId) : undefined,
      search: search ? String(search) : undefined,
      status: "active",
      minPrice: minPrice ? Number(minPrice) : undefined,
      maxPrice: maxPrice ? Number(maxPrice) : undefined,
      hasStock: true,
    });
    sendJsonResponse(res, result);
  }

  async listAdminProducts(req: RequestWithId, res: Response): Promise<any> {
    const { page, limit, categoryId, search, status, minPrice, maxPrice } =
      req.query;
    const result = await productService.listProducts({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      categoryId: categoryId ? String(categoryId) : undefined,
      search: search ? String(search) : undefined,
      sellerId: req.userId ?? "",
      status: status
        ? (String(status) as ListProductsParams["status"])
        : undefined,
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

  async createProduct(req: Request, res: Response): Promise<any> {
    const productData = req.body;
    const result = await productService.createProduct(productData);
    sendJsonResponse(res, result);
  }

  async updateProduct(req: Request, res: Response): Promise<any> {
    const { id } = req.params;
    const productData = req.body;
    const result = await productService.updateProduct(id, productData);
    sendJsonResponse(res, result);
  }

  async getProductSalesSummary(req: Request, res: Response): Promise<any> {
    const { id } = req.params;
    const { startAt, endAt } = req.query;
    const result = await productService.getProductSalesSummary({
      productId: id,
      startAt: startAt
        ? new Date(typeof startAt === "number" ? startAt : String(startAt))
        : undefined,
      endAt: endAt
        ? new Date(typeof endAt === "number" ? endAt : String(endAt))
        : undefined,
    });
    sendJsonResponse(res, result);
  }
}

export default new ProductController();

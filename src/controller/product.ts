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

  async updateCategory(req: RequestWithId, res: Response): Promise<any> {
    const result = await productService.updateCategory(
      req.params.id,
      req.body.name,
      req.userId ?? "",
    );
    sendJsonResponse(res, result);
  }

  async deleteCategory(req: RequestWithId, res: Response): Promise<any> {
    const result = await productService.deleteCategory(
      req.params.id,
      req.userId ?? "",
    );
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
    });
    sendJsonResponse(res, result);
  }

  async listAdminProducts(req: RequestWithId, res: Response): Promise<any> {
    const {
      page,
      limit,
      categoryId,
      search,
      status,
      minPrice,
      maxPrice,
      sellerId,
      includeDeleted,
    } =
      req.query;
    const result = await productService.listAdminProducts({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      categoryId: categoryId ? String(categoryId) : undefined,
      search: search ? String(search) : undefined,
      requesterId: req.userId ?? "",
      sellerId: sellerId ? String(sellerId) : undefined,
      includeDeleted:
        includeDeleted === undefined
          ? undefined
          : String(includeDeleted) === "true",
      status: status
        ? (String(status) as ListProductsParams["status"])
        : undefined,
      minPrice: minPrice ? Number(minPrice) : undefined,
      maxPrice: maxPrice ? Number(maxPrice) : undefined,
    });
    sendJsonResponse(res, result);
  }

  async getProduct(req: RequestWithId, res: Response): Promise<any> {
    const { id } = req.params;
    const result = await productService.getProductById(id, req.userId);
    sendJsonResponse(res, result);
  }

  async getProductWithSeller(req: Request, res: Response): Promise<any> {
    const { id } = req.params;
    const result = await productService.getProductWithSellerById(id);
    sendJsonResponse(res, result);
  }

  async createProduct(req: RequestWithId, res: Response): Promise<any> {
    const productData = req.body;
    const result = await productService.createProduct(
      productData,
      req.userId ?? "",
    );
    sendJsonResponse(res, result);
  }

  async updateProduct(req: RequestWithId, res: Response): Promise<any> {
    const { id } = req.params;
    const productData = req.body;
    const result = await productService.updateProduct(
      id,
      productData,
      req.userId ?? "",
    );
    sendJsonResponse(res, result);
  }

  async softDeleteProduct(req: RequestWithId, res: Response): Promise<any> {
    const result = await productService.softDeleteProduct(
      req.params.id,
      req.userId ?? "",
    );
    sendJsonResponse(res, result);
  }

  async permanentlyDeleteProduct(
    req: RequestWithId,
    res: Response,
  ): Promise<any> {
    const result = await productService.permanentlyDeleteProduct(
      req.params.id,
      req.userId ?? "",
    );
    sendJsonResponse(res, result);
  }

  async getProductSalesSummary(req: RequestWithId, res: Response): Promise<any> {
    const { id } = req.params;
    const { startAt, endAt } = req.query;
    const result = await productService.getProductSalesSummary({
      productId: id,
      requesterId: req.userId,
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

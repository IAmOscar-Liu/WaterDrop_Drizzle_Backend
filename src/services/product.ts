import * as schema from "../db/schema";
import { handleServiceError } from "../lib/error";
import {
  getProductById,
  listCategory,
  listProducts,
  type ListProductsParams,
} from "../repository/product";
import { ServiceResponse } from "../type/general";

class ProductService {
  async listCategory(): Promise<ServiceResponse<schema.Category[]>> {
    try {
      const categories = await listCategory();
      if (categories) {
        return { success: true, data: categories };
      } else {
        return {
          success: false,
          statusCode: 404,
          message: "categories not found",
        };
      }
    } catch (error) {
      // console.error(error);
      return handleServiceError(error);
    }
  }

  async listProducts(
    params: ListProductsParams
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof listProducts>>>> {
    try {
      const products = await listProducts(params);
      if (products) {
        return { success: true, data: products };
      } else {
        return {
          success: false,
          statusCode: 404,
          message: "products not found",
        };
      }
    } catch (error) {
      // console.error(error);
      return handleServiceError(error);
    }
  }

  async getProductById(
    id: string
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof getProductById>>>> {
    try {
      const product = await getProductById(id);
      if (product) {
        return { success: true, data: product };
      } else {
        return {
          success: false,
          statusCode: 404,
          message: "product not found",
        };
      }
    } catch (error) {
      // console.error(error);
      return handleServiceError(error);
    }
  }
}

export default new ProductService();

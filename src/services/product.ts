import * as schema from "../db/schema";
import { handleServiceError } from "../lib/error";
import {
  createCategory,
  createProduct,
  getProductById,
  listCategory,
  listProducts,
  updateProduct,
  getProductSalesSummary,
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

  async createCategory(
    categoryData: schema.NewCategory
  ): Promise<ServiceResponse<schema.Category>> {
    try {
      const category = await createCategory(categoryData);
      if (category) {
        return { success: true, data: category };
      } else {
        return {
          success: false,
          statusCode: 404,
          message: "category not found",
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

  async createProduct(
    productDataWithCategoryIds: schema.NewProduct & { categoryIds?: string[] }
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof createProduct>>>> {
    try {
      const { categoryIds, ...productData } = productDataWithCategoryIds;
      const product = await createProduct(productData, categoryIds);
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

  async updateProduct(
    productId: string,
    productDataWithCategoryIds: Partial<Omit<schema.NewProduct, "id">> & {
      categoryIds?: string[];
    }
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof updateProduct>>>> {
    try {
      const { categoryIds, ...productData } = productDataWithCategoryIds;
      const product = await updateProduct(productId, productData, categoryIds);
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

  async getProductSalesSummary(input: {
    productId: string;
    startAt?: Date;
    endAt?: Date;
  }): Promise<
    ServiceResponse<Awaited<ReturnType<typeof getProductSalesSummary>>>
  > {
    try {
      const result = await getProductSalesSummary(input);
      return { success: true, data: result };
    } catch (error) {
      return handleServiceError(error);
    }
  }
}

export default new ProductService();

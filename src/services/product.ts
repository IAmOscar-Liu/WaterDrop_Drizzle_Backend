import * as schema from "../db/schema";
import { handleServiceError } from "../lib/error";
import {
  createCategory,
  createProduct,
  getProductById,
  getProductWithSellerById,
  listCategory,
  listProducts,
  listAdminProducts,
  type ListAdminProductsParams,
  updateProduct,
  getProductSalesSummary,
  type ListProductsParams,
  type ProductVariantWriteInput,
} from "../repository/product";
import { ServiceResponse } from "../type/general";

class ProductService {
  async listCategory(): Promise<ServiceResponse<schema.Category[]>> {
    try {
      const categories = await listCategory();
      return { success: true, data: categories };
    } catch (error) {
      // console.error(error);
      return handleServiceError(error);
    }
  }

  async createCategory(
    categoryData: schema.NewCategory,
  ): Promise<ServiceResponse<schema.Category>> {
    try {
      const category = await createCategory(categoryData);
      return { success: true, data: category };
    } catch (error) {
      // console.error(error);
      return handleServiceError(error);
    }
  }

  async listAdminProducts(
    params: ListAdminProductsParams,
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof listAdminProducts>>>> {
    try {
      const products = await listAdminProducts(params);
      return { success: true, data: products };
    } catch (error) {
      // console.error(error);
      return handleServiceError(error);
    }
  }

  async listProducts(
    params: ListProductsParams,
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof listProducts>>>> {
    try {
      const products = await listProducts(params);
      return { success: true, data: products };
    } catch (error) {
      // console.error(error);
      return handleServiceError(error);
    }
  }

  async getProductById(
    id: string,
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
      return handleServiceError(error);
    }
  }

  async getProductWithSellerById(
    id: string,
  ): Promise<
    ServiceResponse<Awaited<ReturnType<typeof getProductWithSellerById>>>
  > {
    try {
      const product = await getProductWithSellerById(id);
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
      return handleServiceError(error);
    }
  }

  async createProduct(
    productDataWithCategoryIds: Omit<schema.NewProduct, "price"> & {
      categoryIds?: string[];
      variants?: ProductVariantWriteInput[];
    },
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof createProduct>>>> {
    try {
      const { categoryIds, variants, ...productData } =
        productDataWithCategoryIds;
      const product = await createProduct(productData, categoryIds, variants);
      return { success: true, data: product };
    } catch (error) {
      // console.error(error);
      return handleServiceError(error);
    }
  }

  async updateProduct(
    productId: string,
    productDataWithCategoryIds: Partial<
      Omit<schema.NewProduct, "id" | "price">
    > & {
      categoryIds?: string[];
      variants?: ProductVariantWriteInput[];
    },
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof updateProduct>>>> {
    try {
      const { categoryIds, variants, ...productData } =
        productDataWithCategoryIds;
      const product = await updateProduct(
        productId,
        productData,
        categoryIds,
        variants,
      );
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

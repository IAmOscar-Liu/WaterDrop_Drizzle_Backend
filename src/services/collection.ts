import * as schema from "../db/schema";
import { handleServiceError } from "../lib/error";
import {
  findOrCreateCollection,
  listCollections,
  ListCollectionsParams,
  removeCollection,
} from "../repository/collection";
import { ServiceResponse } from "../type/general";

class CollectionService {
  async listCollection(
    params: ListCollectionsParams
  ): Promise<ServiceResponse<Awaited<ReturnType<typeof listCollections>>>> {
    try {
      const collections = await listCollections(params);
      if (collections) {
        return { success: true, data: collections };
      } else {
        return {
          success: false,
          statusCode: 404,
          message: "collections not found",
        };
      }
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async findOrCreateCollection(
    collectionData: Omit<schema.NewCollection, "id" | "createdAt" | "updatedAt">
  ): Promise<
    ServiceResponse<Awaited<ReturnType<typeof findOrCreateCollection>>>
  > {
    try {
      const collection = await findOrCreateCollection(collectionData);
      if (collection) {
        return { success: true, data: collection };
      } else {
        return {
          success: false,
          statusCode: 404,
          message: "collection not found",
        };
      }
    } catch (error) {
      return handleServiceError(error);
    }
  }

  async removeCollection({
    userId,
    productId,
  }: {
    userId: string;
    productId: string;
  }): Promise<ServiceResponse<Awaited<ReturnType<typeof removeCollection>>>> {
    try {
      const result = await removeCollection(userId, productId);
      if (result) {
        return { success: true, data: result };
      } else {
        return {
          success: false,
          statusCode: 404,
          message: "collection not found",
        };
      }
    } catch (error) {
      return handleServiceError(error);
    }
  }
}

export default new CollectionService();

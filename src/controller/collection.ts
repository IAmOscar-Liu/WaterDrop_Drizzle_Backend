import { Response } from "express";
import { sendJsonResponse } from "../lib/general";
import collectionService from "../services/collection";
import { RequestWithId } from "../type/request";

class CollectionController {
  async listCollections(req: RequestWithId, res: Response): Promise<any> {
    const { page, limit, search } = req.query;
    const result = await collectionService.listCollection({
      userId: req.userId ?? "",
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      search: search ? String(search) : undefined,
    });
    sendJsonResponse(res, result);
  }

  async findOrCreateCollection(
    req: RequestWithId,
    res: Response
  ): Promise<any> {
    const { productId } = req.body;
    const result = await collectionService.findOrCreateCollection({
      userId: req.userId ?? "",
      productId,
    });
    sendJsonResponse(res, result);
  }

  async removeCollection(req: RequestWithId, res: Response): Promise<any> {
    const { productId } = req.body;
    const result = await collectionService.removeCollection({
      userId: req.userId ?? "",
      productId,
    });
    sendJsonResponse(res, result);
  }
}

export default new CollectionController();

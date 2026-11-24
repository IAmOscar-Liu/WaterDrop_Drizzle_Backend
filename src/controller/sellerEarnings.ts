import { Response } from "express";
import { RequestWithId } from "../type/request";
import { sendJsonResponse } from "../lib/general";
import service from "../services/sellerEarnings";
function query(req:RequestWithId){return {sellerId:req.query.sellerId?String(req.query.sellerId):undefined,page:Number(req.query.page??1),limit:Number(req.query.limit??20),startAt:req.query.startAt?new Date(String(req.query.startAt)):undefined,endAt:req.query.endAt?new Date(String(req.query.endAt)):undefined};}
export default {
  async reverseShipping(req:RequestWithId,res:Response){sendJsonResponse(res,await service.reverseShipping(req.userId!,req.params.sellerId,req.body));},
  async summary(req:RequestWithId,res:Response){const q=query(req);sendJsonResponse(res,await service.summary(req.userId!,q.sellerId,q.startAt,q.endAt));},
  async history(req:RequestWithId,res:Response){sendJsonResponse(res,await service.history(req.userId!,query(req)));},
  async adjust(req:RequestWithId,res:Response){sendJsonResponse(res,await service.adjust(req.userId!,req.params.sellerId,req.body));},
  async requests(req:RequestWithId,res:Response){sendJsonResponse(res,await service.requests(req.userId!,{...query(req),status:req.query.status as "pending"|"processing"|"completed"|"cancelled"|"rejected"|undefined}));},
  async create(req:RequestWithId,res:Response){sendJsonResponse(res,await service.create(req.userId!,req.body));},
  async review(req:RequestWithId,res:Response){sendJsonResponse(res,await service.review(req.userId!,req.params.id,req.body));},
};

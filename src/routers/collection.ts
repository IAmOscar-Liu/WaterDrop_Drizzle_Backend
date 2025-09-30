import { Router } from "express";
import CollectionController from "../controller/collection";
import isAuth from "../middleware/isAuth";

const router = Router();

router.get("/list", isAuth, CollectionController.listCollections);
router.post("/", isAuth, CollectionController.findOrCreateCollection);
router.delete("/", isAuth, CollectionController.removeCollection);

export default router;

import { Router } from "express";
import ProductController from "../controller/product";
import isAuth from "../middleware/isAuth";

const router = Router();

router.get("/categories/list", isAuth, ProductController.listCategory);
router.get("/list", isAuth, ProductController.listProducts);
router.get("/:id", isAuth, ProductController.getProduct);

export default router;

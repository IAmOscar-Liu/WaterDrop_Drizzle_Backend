import { Router } from "express";
import CartController from "../controller/cart";
import isAuth from "../middleware/isAuth";

const router = Router();

router.get("/list", isAuth, CartController.listCartItems);
router.post("/item", isAuth, CartController.addToCart);

export default router;

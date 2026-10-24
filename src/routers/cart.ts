import { Router } from "express";
import CartController from "../controller/cart";
import isAuth from "../middleware/isAuth";
import validateZod from "../middleware/validateZod";
import { validateCheckoutBody } from "../middleware/cart";

const router = Router();

router.post("/validate-checkout", isAuth, validateZod({ body: validateCheckoutBody }), CartController.validateCheckout);

router.get("/list", isAuth, CartController.listCartItems);
router.post("/item", isAuth, CartController.addToCart);
router.put("/item/toggle", isAuth, CartController.toggleCartItem);
router.put(
  "/item/:cartItemId/variant",
  isAuth,
  CartController.updateCartItemVariant,
);

export default router;

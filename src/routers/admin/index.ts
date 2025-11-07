import { Router } from "express";
import AccountRouter from "./admin-account";
import AdvertisementRouter from "./admin-advertisement";
import FileRouter from "./admin-file";
import OrderRouter from "./admin-order";
import ProductRouter from "./admin-product";
import SystemRouter from "./admin-system";

const router = Router();

router.use("/account", AccountRouter);
router.use("/product", ProductRouter);
router.use("/advertisement", AdvertisementRouter);
router.use("/order", OrderRouter);
router.use("/file", FileRouter);
router.use("/system", SystemRouter);

export default router;

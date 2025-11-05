import { Router } from "express";
import AccountRouter from "./admin-account";
import AdvertisementRouter from "./admin-advertisement";
import FileRouter from "./admin-file";
import ProductRouter from "./admin-product";

const router = Router();

router.use("/account", AccountRouter);
router.use("/product", ProductRouter);
router.use("/advertisement", AdvertisementRouter);
router.use("/file", FileRouter);

export default router;

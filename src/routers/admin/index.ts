import { Router } from "express";
import AccountRouter from "./admin-account";
import AdvertisementRouter from "./admin-advertisement";
import ChatroomRouter from "./admin-chatroom";
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
router.use("/chatroom", ChatroomRouter);
router.use("/system", SystemRouter);

export default router;

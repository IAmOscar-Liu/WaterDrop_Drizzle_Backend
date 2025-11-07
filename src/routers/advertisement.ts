import { Router } from "express";
import AdvertisementController from "../controller/advertisement";
import isAuth from "../middleware/isAuth";

const router = Router();

router.get("/list", isAuth, AdvertisementController.listAdvertisements);

export default router;

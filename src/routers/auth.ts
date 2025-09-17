import { Router } from "express";
import AuthController from "../controller/auth";
import isAuth from "../middleware/isAuth";

const router = Router();

router.post("/login", AuthController.login);
router.get("/profile", isAuth, AuthController.profile);
router.put("/profile", isAuth, AuthController.updateProfile);
router.get("/daily-stats", isAuth, AuthController.dailyStats);
router.get("/referral/:referralCode", AuthController.validateReferralCode);
router.post("/join-group", isAuth, AuthController.joinGroup);

router.post("/reset/daily-stats", isAuth, AuthController.resetDailyStats);

export default router;

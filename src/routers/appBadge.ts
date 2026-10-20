import { Router } from "express";
import { badgeQuery } from "../middleware/appBadge";
import isAuth from "../middleware/isAuth";
import validateZod from "../middleware/validateZod";
import { badge } from "../controller/appBadge";

// App-only contract is documented in the Flutter handoff, never admin Swagger.
const router = Router();
router.get("/badge", isAuth, validateZod({ query: badgeQuery }), badge);
export default router;

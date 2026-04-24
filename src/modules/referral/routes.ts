import { Router } from "express";
import { requireAuth as auth } from "@middleware/auth";
import {
  getMyReferralCode,
  applyCode,
  getReferralStats,
  checkFreeDelivery,
} from "./controllers";

const router = Router();

router.get("/my-code", auth("user"), getMyReferralCode);
router.post("/apply", auth("user"), applyCode);
router.get("/stats", auth("user"), getReferralStats);
router.get("/free-delivery", auth("user"), checkFreeDelivery);

export default router;
import { Router } from "express";
import { requireAuth as auth } from "@middleware/auth";
import {
  subscribeToPush,
  unsubscribeFromPush,
  getVapidPublicKey,
} from "./controllers";

const router = Router();

router.get("/public-key", getVapidPublicKey);
router.post("/subscribe", auth("any"), subscribeToPush);
router.delete("/unsubscribe", auth("any"), unsubscribeFromPush);

export default router;
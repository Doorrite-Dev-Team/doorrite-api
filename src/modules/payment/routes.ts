import { Router } from "express";
import { requireAuth as auth } from "@middleware/auth";
import {
  createPaymentIntent,
  confirmPayment,
  handleWebhook,
  checkPaymentStatus,
  processRefund,
} from "./controllers";

const router = Router();

router.post("/create-intent", auth("user"), createPaymentIntent);

router.post("/confirm", auth("user"), confirmPayment);

router.post("/webhook", handleWebhook);

router.get("/:orderId/status", auth("any"), checkPaymentStatus);

router.post("/:orderId/refund", auth("admin"), processRefund);

export default router;

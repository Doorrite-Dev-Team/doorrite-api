import { Router } from "express";
import {requireAuth as auth} from "@middleware/auth";
import {
  createPaymentIntent,
  confirmPayment,
  handleWebhook,
  checkPaymentStatus,
  processRefund,
} from "./controllers";

const router = Router();

// Create payment intent - Initializes payment process
router.post("/create-intent", auth("user"), createPaymentIntent);

// Confirm payment after user completes payment
router.post("/confirm", auth("user"), confirmPayment);

// Handle provider webhook (no auth - verified by signature)
router.post("/webhook", handleWebhook);

// Check payment status for an order
router.get(
  "/:orderId/status",
  auth("any"),
  checkPaymentStatus
);

// Process refund (admin only)
router.post("/:orderId/refund", auth("admin"), processRefund);

export default router;

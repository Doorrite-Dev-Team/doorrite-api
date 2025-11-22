import { Router } from "express";
import { requireAuth as auth } from "@middleware/auth";
import {
  getOrders,
  getOrderById,
  createOrder,
  cancelOrder,
  createPaymentIntent,
  confirmPayment,
  checkPaymentStatus,
  processRefund,
  getCustomerVerificationCode,
} from "./controllers";

const router = Router();

router.get("/", auth("any"), getOrders);

router.get("/:id", auth("any"), getOrderById);

router.post("/", auth("user"), createOrder);

router.patch("/:id/cancel", auth("user"), cancelOrder);

// Payment-related endpoints (moved into orders module)
router.post("/:id/payments/create-intent", auth("user"), createPaymentIntent);

router.post("/:id/payments/confirm", auth("any"), confirmPayment);

router.post("/:id/payments/refund", auth("any"), processRefund);

router.get("/:id/payments/status", auth("any"), checkPaymentStatus);

router.get(
  "/orders/:orderId/verification",
  auth("user"),
  getCustomerVerificationCode,
);

export default router;

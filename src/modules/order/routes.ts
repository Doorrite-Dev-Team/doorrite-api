import { Router } from "express";
import { requireAuth as auth } from "@middleware/auth";
import {
  getOrders,
  getOrderById,
  createOrder,
  cancelOrder,
  getCustomerVerificationCode,
} from "./controllers";
import {
  createPaymentIntent,
  verifyPayment,
  checkPaymentStatus,
  processRefund,
} from "../_payment/controllers";

const router = Router();

// ============================================================================
// ORDER ROUTES
// ============================================================================

// Get all orders with filters
router.get("/", auth("any"), getOrders);

// Get single order by ID
router.get("/:id", auth("any"), getOrderById);

// Create new order
router.post("/", auth("user"), createOrder);

// Cancel order
router.patch("/:id/cancel", auth("user"), cancelOrder);

// Get delivery verification code
router.get("/:id/verification", auth("user"), getCustomerVerificationCode);

// ============================================================================
// PAYMENT ROUTES (nested under orders)
// ============================================================================

// Initialize payment intent (redirect to Paystack)
router.post("/:id/payments/create-intent", auth("user"), createPaymentIntent);

// Verify payment after Paystack redirect
router.post("/:id/payments/verify", auth("any"), verifyPayment);

// Check payment status
router.get("/:id/payments/status", auth("any"), checkPaymentStatus);

// Process refund (admin only)
router.post("/:id/payments/refund", auth("admin"), processRefund);

export default router;

import { Router } from "express";
import { requireAuth as auth } from "@middleware/auth";
import {
  getOrders,
  getOrderById,
  createOrder,
  cancelOrder,
  getCustomerVerificationCode,
  getPendingReviews,
  getOrderMessages,
  verifyDeliveryByUser,
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

// Get pending reviews for user - MUST be before /:id
router.get("/pending-review", auth("user"), getPendingReviews);

// Get order chat messages - MUST be before /:id
router.get("/:id/messages", auth("any"), getOrderMessages);

// Get delivery verification code - MUST be before /:id
router.get("/:id/verification", auth("user"), getCustomerVerificationCode);

// Verify delivery by user - MUST be before /:id
router.post("/:id/verify-delivery", auth("user"), verifyDeliveryByUser);

// Cancel order - MUST be before /:id
router.patch("/:id/cancel", auth("user"), cancelOrder);

// Get single order by ID - MUST be last
router.get("/:id", auth("any"), getOrderById);

// Create new order
router.post("/", auth("user"), createOrder);

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

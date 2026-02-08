import { Router } from "express";
import { handlePaystackWebhook } from "../_payment/controllers";

const router = Router();

// ============================================================================
// WEBHOOK ROUTES
// ============================================================================

/**
 * Paystack webhook endpoint
 * No authentication required - validated via signature
 * Configure this URL in your Paystack dashboard:
 * https://yourdomain.com/api/v1/webhook/paystack
 */
router.post("/paystack", handlePaystackWebhook);

export default router;

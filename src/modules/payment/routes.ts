// src/routes/payments.ts
import express from "express";
import { requireAuth } from "middleware/auth";
import * as Payments from "./controllers";

const router = express.Router();

// =========================
// PROTECTED ROUTES
// =========================

// Create a new payment (Customer after placing order)
router.post("/create", requireAuth("CUSTOMER"), Payments.createPayment);

// Update payment status (Vendor/Admin or webhook)
router.patch("/:id/status", requireAuth("CUSTOMER"), Payments.updatePaymentStatus);

// Get payment for a specific order (Customer/Vendor/Admin)
router.get("/order/:orderId", Payments.getPaymentByOrder);

export default router;

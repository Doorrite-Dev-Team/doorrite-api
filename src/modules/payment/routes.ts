// src/routes/payments.ts
import express from "express";
import { requireAuth } from "middleware/auth";
import * as Payments from "./controllers";

const router = express.Router();

// =========================
// PROTECTED ROUTES
// =========================

// Create a new payment (Customer after placing order)
// POST /api/v1/payments/
router.post("/", requireAuth("CUSTOMER"), Payments.createPayment);

// Update payment status (Vendor/Admin or webhook)
// PATCH /api/v1/payments/:id/status
router.patch("/:id/status", requireAuth("CUSTOMER"), Payments.updatePaymentStatus);

export default router;

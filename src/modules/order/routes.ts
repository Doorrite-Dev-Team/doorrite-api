// src/routes/orders.ts
import { requireAuth } from "@middleware/auth";
import express from "express";
import * as Orders from "./controllers"; // adjust path if your controllers live elsewhere

const router = express.Router();

/**
 * Primary (RESTful) routes
 */

// GET  /api/v1/orders/          -> list orders (customer/vendor depends on controller)
router.get("/", Orders.getOrders);

// GET  /api/v1/orders/:id       -> get orders by id
router.get("/:id", Orders.getOrderById);

// POST /api/v1/orders/          -> create orders
router.post("/", Orders.createOrder);

// lifecycle
// PATCH /api/v1/orders/:id/status -> update orders status (vendor/rider/admin)
router.patch("/:id/status", Orders.updateOrderStatus);

// rider claim (atomic)
// POST /api/v1/orders/:id/claim   -> rider order claim (atomic)
router.post("/:id/claim", requireAuth("RIDER"), Orders.claimOrder);

export default router;

// src/routes/orders.ts
import { requireAuth } from "@middleware/auth";
import express from "express";
import * as Orders from "./controllers"; // adjust path if your controllers live elsewhere

const router = express.Router();

/**
 * Primary (RESTful) routes
 * - GET  /api/v1/order/          -> list orders (customer/vendor depends on controller)
 * - GET  /api/v1/order/:id       -> get order by id
 * - POST /api/v1/order/          -> create order
 * - PATCH /api/v1/order/:id/status -> update order status (vendor/rider/admin)
 * - POST /api/v1/order/:id/claim   -> rider claim (atomic)
 */
router.get("/", Orders.getOrders);
router.get("/:id", Orders.getOrderById);

router.post("/", Orders.createOrder);

// lifecycle
router.patch("/:id/status", Orders.updateOrderStatus);

// rider claim (atomic)
router.post("/:id/claim", requireAuth("RIDER"), Orders.claimOrder);

// Backwards-compatible aliases (optional)
router.get("/getAll", Orders.getOrders);
router.post("/create", Orders.createOrder);

export default router;

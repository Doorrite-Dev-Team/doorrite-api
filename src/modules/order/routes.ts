import { Router } from "express";
import {requireAuth as auth} from "@middleware/auth";
import {
  getOrders,
  getOrderById,
  createOrder,
  cancelOrder
} from "./controllers";

const router = Router();

// List orders with filtering
router.get("/", auth("any"), getOrders);

// Get order by ID
router.get("/:id", auth("any"), getOrderById);

// Create new order
router.post("/", auth("user"), createOrder);

// Cancel order
router.patch("/:id/cancel", auth("user"), cancelOrder);

export default router;

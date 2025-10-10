import { Router } from "express";
import { requireAuth as auth } from "@middleware/auth";
import {
  getOrders,
  getOrderById,
  createOrder,
  cancelOrder,
} from "./controllers";

const router = Router();

router.get("/", auth("any"), getOrders);

router.get("/:id", auth("any"), getOrderById);

router.post("/", auth("user"), createOrder);

router.patch("/:id/cancel", auth("user"), cancelOrder);

export default router;

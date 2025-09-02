// src/routes/auth.ts
import express from "express";
import * as Orders from "./controllers";
const router = express.Router();

router.get("/getAll", Orders.getOrders);
router.get("/:id", Orders.getOrderById)

router.post("/create", Orders.createOrder);


export default router;


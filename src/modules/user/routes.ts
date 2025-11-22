// src/routes/auth.ts
import express from "express";
import { requireAuth } from "@middleware/auth";
import * as User from "./controllers";
import { getCustomerVerificationCode } from "../order/controllers";
const router = express.Router();

// User routes
router.get("/me", requireAuth("user"), User.getCurrentUserProfile);

router.get("/orders", requireAuth("user"), User.getUserOrders);

router.get("/:id", User.getUser);

router.put("/me", requireAuth("user"), User.updateUserProfile);

router.delete("/address", requireAuth("user"), User.deleteAddress);

export default router;

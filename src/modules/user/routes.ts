// src/routes/auth.ts
import express from "express";
import { requireAuth } from "@middleware/auth";
import * as User from "./controllers";
const router = express.Router();

// User routes

router.get("/:id", User.getUser);

router.get("/me", requireAuth("user"), User.getCurrentUserProfile);

router.put("/me", requireAuth("user"), User.updateUserProfile);

router.get("/orders", requireAuth("user"), User.getUserOrders);

export default router;

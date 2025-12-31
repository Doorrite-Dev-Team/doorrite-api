// src/routes/user.ts
import express from "express";
import { requireAuth } from "@middleware/auth";
import * as User from "./controllers";

const router = express.Router();

// Public routes
router.get("/", User.getAllUsers);

// Authenticated user routes
router.get("/me", requireAuth("user"), User.getCurrentUserProfile);
router.put("/me", requireAuth("user"), User.updateUserProfile);
router.put("/me/password", requireAuth("user"), User.changePassword);

router.get("/orders", requireAuth("user"), User.getUserOrders);

router.post("/reviews", requireAuth("user"), User.createUserReview);

router.delete("/address", requireAuth("user"), User.deleteAddress);

// This should be last to avoid conflict with other routes
router.get("/:id", User.getUser);

export default router;

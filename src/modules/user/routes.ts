// src/routes/auth.ts
import express from "express";
import { requireAuth } from "@middleware/auth";
import * as User from "./controllers";
import { getCustomerVerificationCode } from "../order/controllers";
import { getMyReferralCode } from "../referral/controllers";
const router = express.Router();

// User routes - MUST be before /:id catch-all
router.get("/me", requireAuth("user"), User.getCurrentUserProfile);
router.delete("/me", requireAuth("user"), User.deleteMyAccount);
router.get("/orders", requireAuth("user"), User.getUserOrders);
router.put("/me", requireAuth("user"), User.updateUserProfile);

// Favorites
router.get("/favorites", requireAuth("user"), User.getUserFavorites);
router.post("/favorites", requireAuth("user"), User.addFavorite);
router.delete(
  "/favorites/:productId",
  requireAuth("user"),
  User.removeFavorite,
);

// Address CRUD
router.get("/addresses", requireAuth("user"), User.getUserAddresses);
router.post("/addresses", requireAuth("user"), User.createAddress);
router.put("/addresses/:id", requireAuth("user"), User.updateAddress);
router.delete("/address", requireAuth("user"), User.deleteAddress);

//Reviews
router.post("/reviews", requireAuth("user"), User.createUserReview);

//Referral
router.get("/referral/my-code", requireAuth("user"), getMyReferralCode);

// Catch-all - MUST be last
router.get("/:id", User.getUser);

export default router;

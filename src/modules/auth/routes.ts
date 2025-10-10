// src/routes/auth.ts
import express from "express";
import { requireAuth } from "middleware/auth";
import * as userAuth from "./user.controller";
import * as vendorAuth from "./vendor.controller";
import * as riderAuth from "./rider.controller";
import DeliveryCategories, { listAllowedCategoryKeys } from "@lib/category";

const router = express.Router();

/**
 * #swagger.tags = ['Auth']
 * #swagger.summary = 'Create a new user'
 * #swagger.description = 'Register a new user account'
 *
 */
router.post("/create-user", userAuth.createUser);
/**
 * #swagger.tags = ['Auth']
 * #swagger.summary = 'Create a new user 2'
 * #swagger.description = 'Register a new user account'
 */

router.post("/create-otp", userAuth.createOtp);

router.post("/verify-otp", userAuth.verifyOtp);

router.post("/login-user", userAuth.login);

router.post("/refresh-token", userAuth.refreshToken);

router.get("/logout-user", requireAuth, userAuth.logout);

router.post("/forget-password", userAuth.forgottenPassword);

router.post("/reset-password", userAuth.resetPassword);

//VENDOR-AUTH ROUTES
router.post("/create-vendor", vendorAuth.createVendor);

router.post("/create-vendor-otp", vendorAuth.createVendorOtp);

router.post("/verify-vendor-otp", vendorAuth.verifyVendorOtp);

router.post("/login-vendor", vendorAuth.loginVendor);

router.post("/refresh-vendor-token", vendorAuth.refreshVendorToken);

router.get("/logout-vendor", requireAuth, vendorAuth.logoutVendor);

router.post("/forget-vendor-password", vendorAuth.forgottenVendorPassword);

router.post("/reset-vendor-password", vendorAuth.resetVendorPassword);

//RIDER-AUTH ROUTES
router.post("/create-rider", riderAuth.createRider);

router.post("/create-rider-otp", riderAuth.createRiderOtp);

router.post("/verify-rider-otp", riderAuth.verifyRiderOtp);

router.post("/login-rider", riderAuth.loginRider);

router.post("/refresh-rider-token", riderAuth.refreshRiderToken);

router.get("/logout-rider", requireAuth, riderAuth.logoutRider);

router.post("/forgot-rider-password", riderAuth.changeRiderPassword);

router.post("/reset-rider-password", riderAuth.resetRiderPassword);

// Public endpoint: return in-memory vendor categories (no DB)
router.get("/vendor-categories", (req, res) => {
  /**
   * #swagger.tags = ['Auth']
   * #swagger.summary = 'Get vendor categories'
   * #swagger.description = 'Retrieve a list of available vendor categories and their keys.'
   */

  return res.json({
    ok: true,
    categories: DeliveryCategories,
    keys: listAllowedCategoryKeys(),
  });
});

export default router;

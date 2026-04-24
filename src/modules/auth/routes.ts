// src/routes/auth.ts
import express, { type Response } from "express";
import { requireAuth } from "middleware/auth";
import * as userAuth from "./user.controller";
import * as vendorAuth from "./vendor.controller";
import * as riderAuth from "./rider.controller";
import { CUISINES, vendorCategoryId } from "@lib/category";
// import { registrationLimiter } from "@app";

const router = express.Router();

router.post("/create-user", userAuth.createUser);

router.post("/create-otp", userAuth.createOtp);

router.post("/verify-otp", userAuth.verifyOtp);

router.post("/login-user", userAuth.login);

router.post("/refresh-user-token", userAuth.refreshToken);

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
router.get("/vendor-categories", (_, res: Response) => {
  return res.json({
    ok: true,
    categories: CUISINES,
    keys: vendorCategoryId(),
  });
});

export default router;

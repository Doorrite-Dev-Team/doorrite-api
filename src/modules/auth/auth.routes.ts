// src/routes/auth.ts
import express from "express";
import { requireAuth } from "middleware/auth";
import * as userAuth from "./user-auth.controller";
import * as vendorAuth from "./vendor-auth.controller";
const router = express.Router();

// #swagger.tags = ['Auth']
// #swagger.requestBody = {
//   content: {
//     "application/json": {
//       schema: {
//         type: "object",
//         properties: {
//           fullName: { type: "string", example: "Abdulazeez Badmus" },
//           email:    { type: "string", example: "you@example.com" },
//           phoneNumber: { type: "string", example: "08074541709" },
//           password: { type: "string", example: "S3curePassw0rd" }
//         },
//         required: ["fullName", "email", "phoneNumber", "password"]
//       }
//     }
//   }
// }

//USER-AUTH ROUTES
router.post("/create-user", userAuth.createUser);
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


export default router;

// src/routes/auth.ts
import express from "express";
import { requireAuth } from "middleware/auth";
import * as userAuth from "./user.controller";
import * as vendorAuth from "./vendor.controller";
import * as riderAuth from "./rider.controller";
import DeliveryCategories, { listAllowedCategoryKeys } from "@lib/category";

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
/* #swagger.tags = ['Auth']
 #swagger.summary = 'Create a new user'
 #swagger.description = 'Register a new user account'
*/
router.post("/create-otp", userAuth.createOtp);
/* #swagger.tags = ['Auth']
 #swagger.summary = 'Create OTP'
 #swagger.description = 'Send a one-time password to the user'
*/
router.post("/verify-otp", userAuth.verifyOtp);
/* #swagger.tags = ['Auth']
 #swagger.summary = 'Verify OTP'
 #swagger.description = 'Verify the one-time password'
*/
router.post("/login-user", userAuth.login);
/* #swagger.tags = ['Auth']
 #swagger.summary = 'User login'
 #swagger.description = 'Authenticate and receive a JWT'
*/
router.post("/refresh-token", userAuth.refreshToken);
/* #swagger.tags = ['Auth']
 #swagger.summary = 'Refresh token'
 #swagger.description = 'Obtain a new JWT using a refresh token'
*/
router.get("/logout-user", requireAuth, userAuth.logout);
/* #swagger.tags = ['Auth']
 #swagger.summary = 'User logout'
 #swagger.description = 'Log out the currently authenticated user'
*/
router.post("/forget-password", userAuth.forgottenPassword);
/* #swagger.tags = ['Auth']
 #swagger.summary = 'Forgot password'
 #swagger.description = 'Initiate the password reset process'
*/
router.post("/reset-password", userAuth.resetPassword);
/* #swagger.tags = ['Auth']
 #swagger.summary = 'Reset password'
 #swagger.description = 'Reset the user password with a valid token'
*/

//VENDOR-AUTH ROUTES
router.post("/create-vendor", vendorAuth.createVendor);
/* #swagger.tags = ['Auth']
 #swagger.summary = 'Create a new vendor'
 #swagger.description = 'Register a new vendor account'
*/
router.post("/create-vendor-otp", vendorAuth.createVendorOtp);
/* #swagger.tags = ['Auth']
 #swagger.summary = 'Create vendor OTP'
 #swagger.description = 'Send a one-time password to the vendor'
*/
router.post("/verify-vendor-otp", vendorAuth.verifyVendorOtp);
/* #swagger.tags = ['Auth']
 #swagger.summary = 'Verify vendor OTP'
 #swagger.description = 'Verify the one-time password for the vendor'
*/
router.post("/login-vendor", vendorAuth.loginVendor);
/* #swagger.tags = ['Auth']
 #swagger.summary = 'Vendor login'
 #swagger.description = 'Authenticate and receive a JWT for the vendor'
*/
router.post("/refresh-vendor-token", vendorAuth.refreshVendorToken);
/* #swagger.tags = ['Auth']
 #swagger.summary = 'Refresh vendor token'
 #swagger.description = 'Obtain a new JWT for the vendor using a refresh token'
*/
router.get("/logout-vendor", requireAuth, vendorAuth.logoutVendor);
/* #swagger.tags = ['Auth']
 #swagger.summary = 'Vendor logout'
 #swagger.description = 'Log out the currently authenticated vendor'
*/
router.post("/forget-vendor-password", vendorAuth.forgottenVendorPassword);
/* #swagger.tags = ['Auth']
 #swagger.summary = 'Forgot vendor password'
 #swagger.description = 'Initiate the password reset process for the vendor'
*/
router.post("/reset-vendor-password", vendorAuth.resetVendorPassword);
/* #swagger.tags = ['Auth']
 #swagger.summary = 'Reset vendor password'
 #swagger.description = 'Reset the vendor password with a valid token'
*/

//RIDER-AUTH ROUTES
router.post("/create-rider", riderAuth.createRider);
/* #swagger.tags = ['Auth']
 #swagger.summary = 'Create a new rider'
 #swagger.description = 'Register a new rider account'
*/
router.post("/create-rider-otp", riderAuth.createRiderOtp);
/* #swagger.tags = ['Auth']
 #swagger.summary = 'Create rider OTP'
 #swagger.description = 'Send a one-time password to the rider'
*/
router.post("/verify-rider-otp", riderAuth.verifyRiderOtp);
/* #swagger.tags = ['Auth']
 #swagger.summary = 'Verify rider OTP'
 #swagger.description = 'Verify the one-time password for the rider'
*/
router.post("/login-rider", riderAuth.loginRider);
/* #swagger.tags = ['Auth']
 #swagger.summary = 'Rider login'
 #swagger.description = 'Authenticate and receive a JWT for the rider'
*/
router.post("/refresh-rider-token", riderAuth.refreshRiderToken);
/* #swagger.tags = ['Auth']
 #swagger.summary = 'Refresh rider token'
 #swagger.description = 'Obtain a new JWT for the rider using a refresh token'
*/
router.get("/logout-rider", requireAuth, riderAuth.logoutRider);
/* #swagger.tags = ['Auth']
 #swagger.summary = 'Rider logout'
 #swagger.description = 'Log out the currently authenticated rider'
*/
router.post("/forgot-rider-password", riderAuth.changeRiderPassword);
/* #swagger.tags = ['Auth']
 #swagger.summary = 'Forgot rider password'
 #swagger.description = 'Initiate the password reset process for the rider'
*/
router.post("/reset-rider-password", riderAuth.resetRiderPassword);
/* #swagger.tags = ['Auth']
 #swagger.summary = 'Reset rider password'
 #swagger.description = 'Reset the rider password with a valid token'
*/

// Public endpoint: return in-memory vendor categories (no DB)
router.get("/vendor-categories", (req, res) => {
  /* #swagger.tags = ['Auth']
   #swagger.summary = 'Get vendor categories'
   #swagger.description = 'Retrieve a list of all vendor categories'
  */
  return res.json({
    ok: true,
    categories: DeliveryCategories,
    keys: listAllowedCategoryKeys(),
  });
});

export default router;

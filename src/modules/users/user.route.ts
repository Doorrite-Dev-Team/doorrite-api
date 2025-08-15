// src/routes/auth.ts
import express from "express";
import { requireAuth } from "middleware/auth";
import * as auth from "./user.controller";
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
router.post("/auth/create-user", auth.createUser);
router.post("/auth/create-otp", auth.createOtp);
router.post("/auth/verify-otp", auth.verifyOtp);
router.post("/auth/login-user", auth.login);
router.post("/auth/refresh-token", auth.refreshToken);
router.get("/auth/logout-user", requireAuth, auth.logout);
router.post("/auth/forget-password", auth.ForgottenPassword);
router.post("/auth/reset-password", auth.resetPassword);

router.get("get-user", requireAuth, auth.getUser);


export default router;

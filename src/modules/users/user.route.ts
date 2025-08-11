// src/routes/auth.ts
import express from "express";
import { requireAuth } from "middleware/auth";
import * as auth from "./user.controller";
const router = express.Router();

router.post("/create-user", auth.createUser);
router.post("/create-otp", auth.createOtp);
router.post("/verify-otp", auth.verifyOtp);
router.post("/login-user", auth.login);
router.post("/refresh-token", auth.refreshToken);
router.get("/logout-user", requireAuth, auth.logout);
router.get("/get-user", requireAuth,  auth.getUser);



export default router;

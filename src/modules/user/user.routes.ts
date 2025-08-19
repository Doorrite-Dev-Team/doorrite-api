// src/routes/auth.ts
import express from "express";
import { requireAuth } from "middleware/auth";
import * as auth from "./user.controller";
const router = express.Router();


router.get("/get-user", requireAuth, auth.getUser);


export default router;

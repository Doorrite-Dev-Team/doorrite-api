// src/routes/auth.ts
import express from "express";
import * as User from "./controllers";
const router = express.Router();

// User routes

// GET api/v1/users/:id
router.get("/:id", User.getUser);

// GET api/v1/users/me
router.get("/me", User.getCurrentUserProfile);

// PUT api/v1/users/me
router.put("/me", User.updateUserProfile);

// GET api/v1/users/Order
router.get("/orders", User.getUserOrders);



export default router;

// src/routes/auth.ts
import express from "express";
import { requireAuth } from "@middleware/auth";
import * as User from "./controllers";
const router = express.Router();

// User routes

router.get("/:id", User.getUser);
/* #swagger.tags = ['User']
 #swagger.summary = 'Get user by ID'
 #swagger.description = 'Retrieve a single user by their ID'
*/

router.get("/me", requireAuth("user"), User.getCurrentUserProfile);
/* #swagger.tags = ['User']
 #swagger.summary = 'Get current user profile'
 #swagger.description = 'Retrieve the profile of the currently authenticated user'
*/

router.put("/me", requireAuth("user"), User.updateUserProfile);
/* #swagger.tags = ['User']
 #swagger.summary = 'Update user profile'
 #swagger.description = 'Update the profile of the currently authenticated user'
*/

router.get("/orders", requireAuth("user"), User.getUserOrders);
/* #swagger.tags = ['User', 'Order']
 #swagger.summary = 'Get user orders'
 #swagger.description = 'Retrieve a list of orders for the authenticated user'
*/

export default router;

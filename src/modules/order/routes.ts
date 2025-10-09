import { Router } from "express";
import {requireAuth as auth} from "@middleware/auth";
import {
  getOrders,
  getOrderById,
  createOrder,
  cancelOrder
} from "./controllers";

const router = Router();

router.get("/", auth("any"), getOrders);
/* #swagger.tags = ['Order']
 #swagger.summary = 'List orders'
 #swagger.description = 'Retrieve a list of orders with optional filtering'
*/

router.get("/:id", auth("any"), getOrderById);
/* #swagger.tags = ['Order']
 #swagger.summary = 'Get order by ID'
 #swagger.description = 'Retrieve a single order by its ID'
*/

router.post("/", auth("user"), createOrder);
/* #swagger.tags = ['Order']
 #swagger.summary = 'Create a new order'
 #swagger.description = 'Create a new order for the authenticated user'
*/

router.patch("/:id/cancel", auth("user"), cancelOrder);
/* #swagger.tags = ['Order']
 #swagger.summary = 'Cancel an order'
 #swagger.description = 'Cancel an existing order'
*/

export default router;

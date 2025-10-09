import { Router } from "express";
import {requireAuth as auth} from "@middleware/auth";
import {
  createPaymentIntent,
  confirmPayment,
  handleWebhook,
  checkPaymentStatus,
  processRefund,
} from "./controllers";

const router = Router();

router.post("/create-intent", auth("user"), createPaymentIntent);
/* #swagger.tags = ['Payment']
 #swagger.summary = 'Create payment intent'
 #swagger.description = 'Initializes the payment process for an order'
*/

router.post("/confirm", auth("user"), confirmPayment);
/* #swagger.tags = ['Payment']
 #swagger.summary = 'Confirm payment'
 #swagger.description = 'Confirm payment after user completes the transaction'
*/

router.post("/webhook", handleWebhook);
/* #swagger.tags = ['Payment']
 #swagger.summary = 'Handle payment webhook'
 #swagger.description = 'Handle webhook notifications from the payment provider'
*/

router.get("/:orderId/status", auth("any"), checkPaymentStatus);
/* #swagger.tags = ['Payment']
 #swagger.summary = 'Check payment status'
 #swagger.description = 'Check the payment status for a specific order'
*/

router.post("/:orderId/refund", auth("admin"), processRefund);
/* #swagger.tags = ['Payment']
 #swagger.summary = 'Process refund'
 #swagger.description = 'Process a refund for a specific order (admin only)'
*/

export default router;

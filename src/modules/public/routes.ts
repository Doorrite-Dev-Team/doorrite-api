import { Router } from "express";
import * as publicController from "./controllers";

const router = Router();
router.use("/paystack-webhook", publicController.handleWebhook);

export default router;

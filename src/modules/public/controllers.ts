// import { prisma } from '@config/db';
import paystack from "@config/payments/paystack";
import { AppError, sendSuccess, handleError } from "@lib/utils/AppError";
import { handleSuccessfulCharge } from "@modules/_payment/helper";
import { Request, Response } from "express";
// import { prisma} from '../../generated/prisma';

// POST /paystack-webhook
export const handleWebhook = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Payment']
   * #swagger.summary = 'Handle Paystack webhook'
   * #swagger.description = 'Handles webhook events from Paystack.'
   */
  try {
    const rawBody = JSON.stringify(req.body);
    const signature = req.headers["x-paystack-signature"] as string | undefined;
    if (!paystack.validateWebhookSignature(rawBody, signature)) {
      throw new AppError(400, "Invalid signature");
    }

    const event = req.body;

    // Handle specific webhook events
    switch (event.event) {
      case "charge.success":
        await handleSuccessfulCharge(event.data);
        break;
      // For transfers/refunds we currently update payment records directly when Paystack calls back
      case "transfer.success":
        // no-op or log; refund handling is handled during refund initiation
        console.log("transfer.success", event.data);
        break;
      case "transfer.failed":
        console.log("transfer.failed", event.data);
        break;
      default:
        console.log("Unhandled webhook event:", event.event);
    }

    return sendSuccess(res, { message: "Webhook processed" });
  } catch (error: any) {
    console.error("Webhook error:", error);
    return handleError(res, error);
  }
};

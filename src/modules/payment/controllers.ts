import { Request, Response } from "express";
import { AppError, handleError, sendSuccess } from "@lib/utils/AppError";
import { getActorFromReq } from "@lib/utils/req-res";
import prisma from "@config/db";
import paystack from "@config/payments/paystack";
import { handleSuccessfulCharge } from "../payment/helper";
import socketService from "@lib/socketService";

// POST /payments/create-intent
export const createPaymentIntent = async (req: Request, res: Response) => {
  try {
    const { orderId } = req.body;
    const actor = getActorFromReq(req);

    if (!actor?.id) throw new AppError(401, "Unauthorized");
    if (!orderId) throw new AppError(400, "Order ID is required");

    const result = await prisma.$transaction(async (tx) => {
      // 1. Fetch order and verify ownership
      const order = await tx.order.findFirst({
        where: {
          id: orderId,
          customerId: actor.id,
          status: "PENDING",
          paymentStatus: "PENDING",
        },
        include: {
          customer: {
            select: {
              email: true,
              fullName: true,
              phoneNumber: true,
            },
          },
        },
      });

      if (!order) {
        throw new AppError(404, "Order not found or payment already initiated");
      }

      // 2. Initialize Paystack transaction using helper
      const init = await paystack.initializeTransaction({
        email: order.customer.email,
        amount: order.totalAmount,
        reference: `ORDER_${order.id}_${Date.now()}`,
        callback_url: `${process.env.FRONTEND_URL}/payment/verify`,
        metadata: {
          order_id: order.id,
          custom_fields: [
            {
              display_name: "Order ID",
              variable_name: "order_id",
              value: order.id,
            },
          ],
        },
      });

      // 3. Create payment record
      const payment = await tx.payment.create({
        data: {
          orderId: order.id,
          userId: actor.id,
          amount: order.totalAmount,
          status: "PENDING",
          method: "PAYSTACK",
          transactionId: init.reference,
        },
      });

      // 4. Update order payment status (keep as PENDING until verification)
      await tx.order.update({
        where: { id: order.id },
        data: { paymentStatus: "PENDING" },
      });

      return {
        paymentId: payment.id,
        authorization_url: init.authorization_url,
      };
    });

    return sendSuccess(res, {
      ...result,
      message: "Payment initialized successfully",
    });
  } catch (error: any) {
    console.error("Payment intent error:", error);
    return handleError(res, error);
  }
};

// POST /payments/confirm
export const confirmPayment = async (req: Request, res: Response) => {
  try {
    const { reference } = req.body;
    const actor = getActorFromReq(req);

    if (!actor?.id) throw new AppError(401, "Unauthorized");
    if (!reference) throw new AppError(400, "Payment reference is required");

    const result = await prisma.$transaction(async (tx) => {
      // 1. Verify payment exists
      const payment = await tx.payment.findFirst({
        where: {
          transactionId: reference,
          userId: actor.id,
        },
        include: {
          order: true,
        },
      });

      if (!payment) {
        throw new AppError(404, "Payment not found");
      }

      // 2. Verify with Paystack via helper
      const verifyResponse = await paystack.verifyTransaction(reference);
      const paymentData = verifyResponse.raw;
      // Map Paystack status to our Prisma PaymentStatus enum
      const status = paymentData.status === "success" ? "SUCCESSFUL" : "FAILED";

      // 3. Update payment record
      const updatedPayment = await tx.payment.update({
        where: { id: payment.id },
        data: {
          status,
          paidAt: status === "SUCCESSFUL" ? new Date() : undefined,
        },
      });

      // 4. Update order status (on success we mark order ACCEPTED, otherwise leave as-is)
      const orderUpdateData: any = { paymentStatus: status };
      if (status === "SUCCESSFUL") orderUpdateData.status = "ACCEPTED";

      await tx.order.update({
        where: { id: payment.orderId },
        data: orderUpdateData,
      });

      // 5. Create order history entry
      await tx.orderHistory.create({
        data: {
          orderId: payment.orderId,
          status: status === "SUCCESSFUL" ? "ACCEPTED" : "PENDING",
          actorId: actor.id,
          actorType: "SYSTEM",
          note: `Payment ${status.toLowerCase()} - Reference: ${reference}`,
        },
      });

      return { status, payment: updatedPayment };
    });

    // Emit order update after transaction completes
    try {
      socketService.emitOrderUpdate({
        orderId: result.payment.orderId,
        paymentStatus: result.status,
      });
    } catch (e: Error | any) {
      console.warn("Failed to emit order update:", e?.message || e);
    }

    return sendSuccess(res, {
      ...result,
      message: `Payment ${result.status.toLowerCase()} successfully`,
    });
  } catch (error: any) {
    console.error("Payment confirmation error:", error);
    return handleError(res, error);
  }
};

// POST /payments/webhook
export const handleWebhook = async (req: Request, res: Response) => {
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

// GET /payments/:orderId/status
export const checkPaymentStatus = async (req: Request, res: Response) => {
  try {
    const { orderId } = req.params;
    const actor = getActorFromReq(req);

    if (!actor?.id) throw new AppError(401, "Unauthorized");

    // Build role-aware query
    const where: any = { orderId };
    if (actor.role === "CUSTOMER") {
      where.userId = actor.id;
    } else if (actor.role === "VENDOR") {
      where.order = { vendorId: actor.id };
    }

    const payment = await prisma.payment.findFirst({
      where,
      include: {
        order: {
          select: {
            id: true,
            status: true,
            paymentStatus: true,
            totalAmount: true,
          },
        },
      },
    });

    if (!payment) {
      throw new AppError(404, "Payment not found");
    }

    return sendSuccess(res, { payment });
  } catch (error: any) {
    console.error("Payment status check error:", error);
    return handleError(res, error);
  }
};

// POST /payments/:orderId/refund
export const processRefund = async (req: Request, res: Response) => {
  try {
    const { orderId } = req.params;
    const { reason, amount } = req.body;
    const actor = getActorFromReq(req);

    if (!actor?.id) throw new AppError(401, "Unauthorized");
    if (actor.role !== "ADMIN") throw new AppError(403, "Unauthorized");
    if (!reason) throw new AppError(400, "Refund reason is required");

    const result = await prisma.$transaction(async (tx) => {
      // 1. Fetch payment and verify status
      const payment = await tx.payment.findFirst({
        where: {
          orderId,
          status: "SUCCESSFUL",
        },
        include: {
          order: {
            select: {
              id: true,
              status: true,
              totalAmount: true,
              customerId: true,
            },
          },
        },
      });

      if (!payment) {
        throw new AppError(404, "No completed payment found for this order");
      }

      const refundAmount = amount || payment.amount;
      if (refundAmount > payment.amount) {
        throw new AppError(400, "Refund amount cannot exceed payment amount");
      }
      // 2. Ensure we have a transaction id
      if (!payment.transactionId)
        throw new AppError(400, "No transaction id available for this payment");

      // 3. Initialize refund with Paystack via helper
      const refundResponse = await paystack.refundTransaction(
        payment.transactionId,
        refundAmount
      );

      // 4. Update payment & order records accordingly (no Refund model in schema)
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: "REFUNDED" },
      });

      await tx.order.update({
        where: { id: orderId },
        data: {
          status: "CANCELLED",
          paymentStatus: "REFUNDED",
        },
      });

      // 5. Create order history entry
      await tx.orderHistory.create({
        data: {
          orderId,
          status: "CANCELLED",
          actorId: actor.id,
          actorType: "ADMIN",
          note: `Refund initiated: ${reason}`,
        },
      });

      return { refund: refundResponse.raw };
    });

    // Emit order update
    try {
      socketService.emitOrderUpdate({
        orderId,
        status: "CANCELLED",
        paymentStatus: "REFUNDED",
      });
    } catch (e: Error | any) {
      console.warn("Failed to emit order update:", e?.message || e);
    }

    return sendSuccess(res, {
      ...result,
      message: "Refund initiated successfully",
    });
  } catch (error: any) {
    console.error("Refund processing error:", error);
    return handleError(res, error);
  }
};

// =========================
// Update Payment Status (internal use)
// =========================

// PATCH /payments/:id/status
export const updatePaymentStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body; // e.g. "paid" | "failed"

    // Only vendor/admin/webhook should be able to do this
    const payment = await prisma.payment.update({
      where: { id },
      data: { status },
    });

    return sendSuccess(res, { payment });
  } catch (error: any) {
    handleError(res, error);
  }
};

// =========================
// Get Payment by Order
// =========================

// GET /payments/order/:orderId
export const getPaymentByOrder = async (req: Request, res: Response) => {
  try {
    const { orderId } = req.params;

    const payment = await prisma.payment.findFirst({
      where: { orderId },
    });

    if (!payment) throw new AppError(404, "Payment not found");

    return sendSuccess(res, { payment });
  } catch (error: any) {
    handleError(res, error);
  }
};

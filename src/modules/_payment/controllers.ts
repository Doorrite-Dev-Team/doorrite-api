import { AppError, handleError, sendSuccess } from "@lib/utils/AppError";
import { getActorFromReq } from "@lib/utils/req-res";
import { Request, Response } from "express";
import prisma from "@config/db";
import paystack from "@config/payments/paystack";
import { redis } from "@config/redis";
import { socketService } from "@config/socket";
import { AppSocketEvent } from "constants/socket";

// ============================================================================
// POST /orders/:id/payments/create-intent
// Initialize Paystack payment with null handling
// ============================================================================
export const createPaymentIntent = async (req: Request, res: Response) => {
  try {
    const { id: orderId } = req.params;
    const actor = getActorFromReq(req);
    const role = String(actor?.role || "").toLowerCase();

    if (!actor || (role !== "user" && role !== "customer")) {
      throw new AppError(401, "Unauthorized");
    }

    if (!orderId) {
      throw new AppError(400, "Order ID is required");
    }

    const order = await prisma.order.findFirst({
      where: {
        id: orderId,
        customerId: actor.id,
        status: "PENDING_PAYMENT",
        paymentStatus: "PENDING",
      },
      include: {
        customer: { select: { email: true } },
      },
    });

    if (!order) {
      throw new AppError(404, "Order not found or payment already initiated");
    }

    const cacheKey = `payment:init:${order.id}`;
    const lockKey = `payment:init:lock:${order.id}`;

    const cached = await redis.get(cacheKey);
    if (cached) {
      const parsed = typeof cached === "string" ? JSON.parse(cached) : cached;
      return sendSuccess(res, {
        ...parsed,
        message: "Payment intent retrieved from cache",
      });
    }

    const lock = await redis.set(lockKey, "1", { nx: true, ex: 30 });
    if (!lock) {
      throw new AppError(409, "Payment initialization in progress");
    }

    try {
      const reference = `ORDER_${order.id}_${Date.now()}`;
      const callbackUrl = `${process.env.FRONTEND_URL ?? "https://doorrite-user-ui.netlify.app"}/order/${orderId}?verify=true`;

      // Initialize with Paystack SDK
      const initData = await paystack.initializeTransaction(
        order.customer.email,
        order.totalAmount,
        reference,
        callbackUrl,
        {
          order_id: order.id,
          customer_id: order.customerId,
        },
      );

      // Handle null response from Paystack
      if (!initData || !initData.authorization_url) {
        throw new AppError(
          502,
          "Failed to initialize payment with Paystack. Please try again.",
        );
      }

      const result = await prisma.$transaction(async (tx) => {
        const existingPayment = await tx.payment.findFirst({
          where: { orderId: order.id, status: "PENDING" },
        });

        const payment = existingPayment
          ? await tx.payment.update({
              where: { id: existingPayment.id },
              data: {
                transactionId: initData.reference,
                method: "PAYSTACK",
              },
            })
          : await tx.payment.create({
              data: {
                orderId: order.id,
                userId: actor.id,
                amount: order.totalAmount,
                status: "PENDING",
                method: "PAYSTACK",
                transactionId: initData.reference,
              },
            });

        return {
          paymentId: payment.id,
          authorization_url: initData.authorization_url,
          reference: initData.reference,
          access_code: initData.access_code,
        };
      });

      await redis.set(cacheKey, JSON.stringify(result), { ex: 600 });

      return sendSuccess(res, {
        ...result,
        message: "Payment initialized successfully",
      });
    } finally {
      await redis.del(lockKey);
    }
  } catch (error: any) {
    console.error("Payment intent error:", error);
    return handleError(res, error);
  }
};

// ============================================================================
// POST /orders/:id/payments/verify
// Verify payment with proper null handling
// ============================================================================
export const verifyPayment = async (req: Request, res: Response) => {
  try {
    const { id: orderId } = req.params;
    const { reference } = req.query;
    const actor = getActorFromReq(req);

    if (!actor) throw new AppError(401, "Unauthorized");
    if (!orderId) throw new AppError(400, "Order ID is required");
    if (!reference || typeof reference !== "string") {
      throw new AppError(400, "Payment reference is required");
    }

    const lockKey = `payment:verify:lock:${reference}`;
    const lock = await redis.set(lockKey, "1", { nx: true, ex: 30 });

    if (!lock) {
      const payment = await prisma.payment.findFirst({
        where: { transactionId: reference },
        include: { order: true },
      });

      if (payment) {
        return sendSuccess(res, {
          status: payment.status,
          order: payment.order,
          message: "Payment verification in progress",
        });
      }
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        const payment = await tx.payment.findFirst({
          where: {
            transactionId: reference,
            orderId: orderId,
          },
          include: {
            order: {
              include: {
                customer: true,
                vendor: true,
              },
            },
          },
        });

        if (!payment) {
          throw new AppError(404, "Payment not found");
        }

        const role = String(actor.role || "").toLowerCase();
        if (role === "user" || role === "customer") {
          if (payment.order.customerId !== actor.id) {
            throw new AppError(403, "Unauthorized to verify this payment");
          }
        }

        if (payment.status !== "PENDING") {
          return {
            status: payment.status,
            order: payment.order,
            alreadyProcessed: true,
          };
        }

        // Verify with Paystack SDK
        const verificationData = await paystack.verifyTransaction(reference);

        // Handle null response from Paystack
        if (!verificationData) {
          throw new AppError(
            502,
            "Unable to verify payment with Paystack. Please try again later.",
          );
        }

        // Validate amount
        const paystackAmountKobo = Number(verificationData.amount || 0);
        const expectedKobo = Math.round(payment.amount * 100);

        if (Math.abs(paystackAmountKobo - expectedKobo) > 1) {
          throw new AppError(
            400,
            `Payment amount mismatch. Expected ₦${payment.amount}, got ₦${paystackAmountKobo / 100}`,
          );
        }

        // Determine status
        const paymentStatus = paystack.isTransactionSuccessful(verificationData)
          ? "SUCCESSFUL"
          : "FAILED";

        const updatedPayment = await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: paymentStatus,
            paidAt: paymentStatus === "SUCCESSFUL" ? new Date() : undefined,
          },
        });

        const orderUpdateData: any = {
          paymentStatus: paymentStatus,
        };

        if (paymentStatus === "SUCCESSFUL") {
          orderUpdateData.status = "PENDING";
        }

        const updatedOrder = await tx.order.update({
          where: { id: payment.orderId },
          data: orderUpdateData,
          include: {
            items: { include: { product: true, variant: true } },
            customer: { select: { id: true, fullName: true, email: true } },
            vendor: { select: { id: true, businessName: true } },
          },
        });

        await tx.orderHistory.create({
          data: {
            orderId: payment.orderId,
            status:
              paymentStatus === "SUCCESSFUL" ? "PENDING" : "PENDING_PAYMENT",
            actorId: actor.id,
            actorType: "SYSTEM",
            note: `Payment ${paymentStatus.toLowerCase()} - Reference: ${reference}`,
          },
        });

        return {
          status: paymentStatus,
          order: updatedOrder,
          payment: updatedPayment,
          alreadyProcessed: false,
        };
      });

      if (result.status === "SUCCESSFUL" && !result.alreadyProcessed) {
        socketService.notify(result.order.vendorId, AppSocketEvent.NEW_ORDER, {
          title: `New Paid Order From: ${result.order.customer.fullName}`,
          type: "ORDER_PLACED",
          message: `Payment confirmed. Order: ${result.order.id}`,
          priority: "high",
          metadata: {
            orderId: result.order.id,
            vendorId: result.order.vendorId,
            amount: result.order.totalAmount,
            actionUrl: `/orders/${result.order.id}`,
          },
          timestamp: new Date().toISOString(),
        });
      }

      return sendSuccess(res, {
        status: result.status,
        order: result.order,
        message: result.alreadyProcessed
          ? "Payment already processed"
          : `Payment ${result.status.toLowerCase()} successfully`,
      });
    } finally {
      await redis.del(lockKey);
    }
  } catch (error: any) {
    console.error("Payment verification error:", error);
    return handleError(res, error);
  }
};

// ============================================================================
// GET /orders/:id/payments/status
// Check current payment status
// ============================================================================
export const checkPaymentStatus = async (req: Request, res: Response) => {
  try {
    const { id: orderId } = req.params;
    const actor = getActorFromReq(req);

    if (!actor) throw new AppError(401, "Unauthorized");

    const where: any = { orderId };
    const role = String(actor.role || "").toLowerCase();

    if (role === "user" || role === "customer") {
      where.userId = actor.id;
    } else if (role === "vendor") {
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

// ============================================================================
// POST /orders/:id/payments/refund
// Process refund with null handling
// ============================================================================
export const processRefund = async (req: Request, res: Response) => {
  try {
    const { id: orderId } = req.params;
    const { reason, amount } = req.body;
    const actor = getActorFromReq(req);

    if (!actor) throw new AppError(401, "Unauthorized");
    const role = String(actor.role || "").toLowerCase();
    if (role !== "admin") throw new AppError(403, "Admin access required");
    if (!reason) throw new AppError(400, "Refund reason is required");

    const result = await prisma.$transaction(async (tx) => {
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
              vendorId: true,
            },
          },
          user: {
            select: {
              id: true,
            },
          },
        },
      });

      if (!payment) {
        throw new AppError(404, "No successful payment found for this order");
      }

      const refundAmount = amount || payment.amount;
      if (refundAmount > payment.amount) {
        throw new AppError(400, "Refund amount cannot exceed payment amount");
      }

      if (!payment.transactionId) {
        throw new AppError(400, "No transaction reference found");
      }

      // Process refund with Paystack SDK
      const refundData = await paystack.refundTransaction(
        payment.transactionId,
        refundAmount,
        reason,
        `Refund for order ${orderId}`,
      );

      // Handle null response from Paystack
      if (!refundData) {
        throw new AppError(
          502,
          "Unable to process refund with Paystack. Please try again later.",
        );
      }

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

      await tx.orderHistory.create({
        data: {
          orderId,
          status: "CANCELLED",
          actorId: actor.id,
          actorType: "ADMIN",
          note: `Refund processed: ${reason}. Amount: ₦${refundAmount}`,
        },
      });

      return {
        refund: refundData,
        amount: refundAmount,
        customerId: payment.user.id,
      };
    });

    socketService.notify(result.customerId, AppSocketEvent.NOTIFICATION, {
      title: "Refund Processed",
      type: "PAYMENT_SUCCESS",
      message: `Your refund of ₦${result.amount} has been processed`,
      priority: "high",
      metadata: {
        orderId,
        amount: result.amount,
      },
      timestamp: new Date().toISOString(),
    });

    return sendSuccess(res, {
      refund: result.refund,
      message: "Refund processed successfully",
    });
  } catch (error: any) {
    console.error("Refund processing error:", error);
    return handleError(res, error);
  }
};

// ============================================================================
// POST /webhook/paystack
// Handle Paystack webhook with null handling
// ============================================================================
export const handlePaystackWebhook = async (req: Request, res: Response) => {
  try {
    const rawBody = JSON.stringify(req.body);
    const signature = req.headers["x-paystack-signature"] as string | undefined;

    if (!paystack.validateWebhookSignature(rawBody, signature)) {
      console.error("Invalid webhook signature");
      throw new AppError(400, "Invalid signature");
    }

    const event = req.body;
    console.log("Paystack webhook event:", event.event);

    switch (event.event) {
      case "charge.success":
        await handleChargeSuccess(event.data);
        break;

      case "transfer.success":
        console.log("Transfer success:", event.data);
        break;

      case "transfer.failed":
        console.log("Transfer failed:", event.data);
        break;

      default:
        console.log("Unhandled webhook event:", event.event);
    }

    return sendSuccess(res, { message: "Webhook processed" });
  } catch (error: any) {
    console.error("Webhook processing error:", error);
    return handleError(res, error);
  }
};

// ============================================================================
// HELPER: Handle charge.success webhook
// ============================================================================
async function handleChargeSuccess(data: any) {
  try {
    const reference = data.reference;

    const payment = await prisma.payment.findFirst({
      where: { transactionId: reference },
      include: {
        order: {
          include: {
            customer: true,
            vendor: true,
          },
        },
      },
    });

    if (!payment) {
      console.error("Payment not found for reference:", reference);
      return;
    }

    if (payment.status !== "PENDING") {
      console.log("Payment already processed:", reference);
      return;
    }

    const paystackAmountKobo = Number(data.amount || 0);
    const expectedKobo = Math.round(payment.amount * 100);

    if (Math.abs(paystackAmountKobo - expectedKobo) > 1) {
      console.error("Amount mismatch in webhook:", {
        expected: expectedKobo,
        received: paystackAmountKobo,
      });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: "SUCCESSFUL",
          paidAt: new Date(),
        },
      });

      await tx.order.update({
        where: { id: payment.orderId },
        data: {
          status: "PENDING",
          paymentStatus: "SUCCESSFUL",
        },
      });

      await tx.orderHistory.create({
        data: {
          orderId: payment.orderId,
          status: "PENDING",
          actorId: payment.userId,
          actorType: "SYSTEM",
          note: `Payment confirmed via webhook - Reference: ${reference}`,
        },
      });
    });

    socketService.notify(payment.order.vendorId, AppSocketEvent.NEW_ORDER, {
      title: `New Paid Order From: ${payment.order.customer.fullName}`,
      type: "ORDER_PLACED",
      message: `Payment confirmed. Order: ${payment.order.id}`,
      priority: "high",
      metadata: {
        orderId: payment.order.id,
        vendorId: payment.order.vendorId,
        amount: payment.order.totalAmount,
        actionUrl: `/orders/${payment.order.id}`,
      },
      timestamp: new Date().toISOString(),
    });

    console.log("Webhook charge.success processed:", reference);
  } catch (error) {
    console.error("Error handling charge.success:", error);
    throw error;
  }
}

export default {
  createPaymentIntent,
  verifyPayment,
  checkPaymentStatus,
  processRefund,
  handlePaystackWebhook,
};

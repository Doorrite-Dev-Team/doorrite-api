import prisma from "@config/db";
import paystack from "@config/payments/paystack";
import { AppError } from "@lib/utils/AppError";
import { socketService } from "@config/socket";
import { AppSocketEvent } from "constants/socket";
import { Payment, Order } from "../generated/prisma";
import { deductVendorEarnings } from "@services/earnings";

export interface RefundResult {
  status: "COMPLETED" | "FAILED" | "MANUAL_REVIEW_REQUIRED";
  refundId?: number;
  amount: number;
  message: string;
}

export class RefundService {
  private static readonly AUTO_REFUND_THRESHOLD = 5000;

  /**
   * Processes a refund for an order cancellation.
   * Handles automatic refunds for small amounts and flags large amounts for manual review.
   */
  static async processCancellationRefund(
    orderId: string,
    payment: Payment,
    cancellationFee: number,
    reason: string,
    actor: { id: string; role: string },
    tx: any, // Use the existing prisma transaction
  ): Promise<RefundResult> {
    const refundAmount = Math.max(0, payment.amount - cancellationFee);

    if (refundAmount <= 0) {
      return {
        status: "COMPLETED",
        amount: 0,
        message: "No refund amount after cancellation fee",
      };
    }

    // 1. Deduct Vendor Earnings if a fee applies
    if (cancellationFee > 0) {
      await deductVendorEarnings(
        orderId,
        `Order cancelled by ${actor.role === "admin" ? "Admin" : "Customer"}`,
      );
    }

    const isAutomatic = refundAmount < this.AUTO_REFUND_THRESHOLD;

    if (!isAutomatic) {
      // Flag for manual review
      await tx.orderHistory.create({
        data: {
          orderId,
          status: "CANCELLED",
          actorId: actor.id,
          actorType: actor.role === "admin" ? "ADMIN" : "USER",
          note: `REFUND_REQUIRED: ₦${refundAmount}. Amount exceeds automatic threshold (₦${this.AUTO_REFUND_THRESHOLD}). Requires admin approval. Reason: ${reason}`,
        },
      });

      return {
        status: "MANUAL_REVIEW_REQUIRED",
        amount: refundAmount,
        message: `Refund of ₦${refundAmount} exceeds automatic threshold and requires admin approval.`,
      };
    }

    // Process automatic refund
    try {
      if (!payment.transactionId) {
        throw new AppError(400, "No transaction reference found for refund");
      }

      // 2. Call Paystack API
      const refundData = await paystack.refundTransaction(
        payment.transactionId,
        refundAmount,
        reason,
        `Cancellation refund for order ${orderId}`,
      );

      if (!refundData) {
        throw new Error("Paystack returned no refund data");
      }

      // 3. Update Database
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: "REFUNDED" },
      });

      await tx.orderHistory.create({
        data: {
          orderId,
          status: "CANCELLED",
          actorId: actor.id,
          actorType: actor.role === "admin" ? "ADMIN" : "USER",
          note: `Automatic refund processed: ₦${refundAmount}. Paystack ID: ${refundData.id}. Reason: ${reason}`,
        },
      });

      // 4. Notify User
      socketService.notify(payment.userId, AppSocketEvent.NOTIFICATION, {
        title: "Refund Processed",
        type: "PAYMENT_SUCCESS",
        message: `Your refund of ₦${refundAmount} has been successfully processed.`,
        priority: "high",
        metadata: {
          orderId,
          amount: refundAmount,
          refundId: refundData.id,
        } as any,
        timestamp: new Date().toISOString(),
      });

      return {
        status: "COMPLETED",
        refundId: refundData.id,
        amount: refundAmount,
        message: "Refund processed successfully",
      };
    } catch (error: any) {
      console.error(`Refund failed for order ${orderId}:`, error);

      // Log failure in history for admin review
      await tx.orderHistory.create({
        data: {
          orderId,
          status: "CANCELLED",
          actorId: actor.id,
          actorType: actor.role === "admin" ? "ADMIN" : "USER",
          note: `REFUND_FAILED: ₦${refundAmount}. Error: ${error.message}. Forwarded to admin for manual processing.`,
        },
      });

      // Notify User of failure
      socketService.notify(payment.userId, AppSocketEvent.NOTIFICATION, {
        title: "Refund Issue",
        type: "SYSTEM",
        message: `We encountered an issue processing your refund of ₦${refundAmount}. Our team has been notified and will resolve it manually.`,
        priority: "high",
        metadata: { orderId } as any,
        timestamp: new Date().toISOString(),
      });

      return {
        status: "FAILED",
        amount: refundAmount,
        message: `Refund failed: ${error.message}. Forwarded to admin.`,
      };
    }
  }
}

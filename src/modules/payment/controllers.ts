// src/routes/payments/controllers.ts
import prisma from "@config/db";
import { AppError, handleError, sendSuccess } from "@lib/utils/AppError";
import { getCustomerIdFromRequest } from "@modules/order/utils";
import { Request, Response } from "express";

// =========================
// Create Payment
// =========================
export const createPayment = async (req: Request, res: Response) => {
  try {
    const { orderId, amount, method } = req.body;
    const userId = getCustomerIdFromRequest(req);


    // TODO: validate order belongs to customer
    const payment = await prisma.payment.create({
      data: {
        userId,
        orderId,
        amount,
        method,
        status: "PENDING", // default for MVP
      },
    });

    return sendSuccess(res, { payment }, 201);
  } catch (error: any) {
    handleError(res, error);
  }
};

// =========================
// Update Payment Status
// =========================
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

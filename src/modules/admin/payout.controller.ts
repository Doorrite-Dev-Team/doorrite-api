import { Request, Response } from "express";
import prisma from "@config/db";
import { AppError, handleError, sendSuccess } from "@lib/utils/AppError";
import { z } from "zod/v3";

const payoutActionSchema = z.object({
  notes: z.string().optional(),
});

export const getAllPayouts = async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;
    const status = req.query.status as string;

    const where: Record<string, unknown> = {};
    if (status) {
      where.status = status;
    }

    const [payouts, total] = await Promise.all([
      prisma.payoutSchedule.findMany({
        where,
        include: {
          wallet: {
            include: {
              rider: {
                select: { id: true, fullName: true, phoneNumber: true },
              },
            },
          },
          transaction: true,
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.payoutSchedule.count({ where }),
    ]);

    const formattedPayouts = payouts.map((p) => ({
      id: p.id,
      amount: p.amount,
      requestType: p.requestType,
      status: p.status,
      bankName: p.bankName,
      accountNumber: p.accountNumber,
      accountName: p.accountName,
      scheduledDate: p.scheduledDate,
      processedAt: p.processedAt,
      adminNotes: p.adminNotes,
      riderId: p.wallet.rider?.id,
      riderName: p.wallet.rider?.fullName,
      riderPhone: p.wallet.rider?.phoneNumber,
      createdAt: p.createdAt,
    }));

    return sendSuccess(res, {
      payouts: formattedPayouts,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const getPayoutById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const payout = await prisma.payoutSchedule.findUnique({
      where: { id },
      include: {
        wallet: {
          include: {
            rider: true,
          },
        },
        transaction: true,
      },
    });

    if (!payout) {
      throw new AppError(404, "Payout not found");
    }

    return sendSuccess(res, { payout });
  } catch (error) {
    return handleError(res, error);
  }
};

export const approvePayout = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const parsed = payoutActionSchema.parse(req.body);
    const adminNotes = parsed.notes;

    const payout = await prisma.payoutSchedule.findUnique({
      where: { id },
      include: { wallet: true },
    });

    if (!payout) {
      throw new AppError(404, "Payout not found");
    }

    if (payout.status !== "PENDING") {
      throw new AppError(400, "Payout is not in pending status");
    }

    const updated = await prisma.payoutSchedule.update({
      where: { id },
      data: {
        status: "APPROVED",
        adminNotes,
        updatedAt: new Date(),
      },
    });

    return sendSuccess(res, {
      payout: updated,
      message: "Payout approved. Process payment and mark as completed.",
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return handleError(
        res,
        new AppError(400, error.errors[0].message),
      );
    }
    return handleError(res, error);
  }
};

export const rejectPayout = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const parsed = payoutActionSchema.parse(req.body);
    const adminNotes = parsed.notes;

    const payout = await prisma.payoutSchedule.findUnique({
      where: { id },
      include: { wallet: true },
    });

    if (!payout) {
      throw new AppError(404, "Payout not found");
    }

    if (payout.status !== "PENDING") {
      throw new AppError(400, "Payout is not in pending status");
    }

    await prisma.$transaction(async (tx) => {
      await tx.payoutSchedule.update({
        where: { id },
        data: {
          status: "REJECTED",
          adminNotes,
          updatedAt: new Date(),
        },
      });

      await tx.wallet.update({
        where: { id: payout.wallet.id },
        data: {
          balance: { increment: payout.amount },
          pendingBalance: { decrement: payout.amount },
        },
      });

      await tx.transaction.update({
        where: { id: payout.transactionId! },
        data: {
          status: "CANCELLED",
          description: `Withdrawal rejected: ${adminNotes || "No reason provided"}`,
        },
      });
    });

    return sendSuccess(res, { message: "Payout rejected and balance restored" });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return handleError(
        res,
        new AppError(400, error.errors[0].message),
      );
    }
    return handleError(res, error);
  }
};

export const completePayout = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const parsed = payoutActionSchema.parse(req.body);
    const adminNotes = parsed.notes;
    const reference = req.body.reference as string;

    const payout = await prisma.payoutSchedule.findUnique({
      where: { id },
      include: { wallet: true },
    });

    if (!payout) {
      throw new AppError(404, "Payout not found");
    }

    if (payout.status !== "APPROVED" && payout.status !== "PROCESSING") {
      throw new AppError(400, "Payout must be approved before completing");
    }

    await prisma.$transaction(async (tx) => {
      await tx.payoutSchedule.update({
        where: { id },
        data: {
          status: "COMPLETED",
          processedAt: new Date(),
          adminNotes,
          updatedAt: new Date(),
        },
      });

      await tx.wallet.update({
        where: { id: payout.wallet.id },
        data: {
          totalWithdrawn: { increment: payout.amount },
          pendingBalance: { decrement: payout.amount },
        },
      });

      if (payout.transactionId) {
        await tx.transaction.update({
          where: { id: payout.transactionId },
          data: {
            status: "COMPLETED",
            reference,
          },
        });
      }
    });

    return sendSuccess(res, {
      message: "Payout completed successfully",
      reference,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return handleError(
        res,
        new AppError(400, error.errors[0].message),
      );
    }
    return handleError(res, error);
  }
};

export const adjustRiderBalance = async (req: Request, res: Response) => {
  try {
    const { riderId } = req.params;
    const { amount, type, description } = req.body;

    if (!amount || !type || !description) {
      throw new AppError(400, "amount, type, and description are required");
    }

    if (!["ADD", "DEDUCT"].includes(type)) {
      throw new AppError(400, "type must be ADD or DEDUCT");
    }

    const wallet = await prisma.wallet.findUnique({
      where: { riderId },
    });

    if (!wallet) {
      throw new AppError(404, "Wallet not found");
    }

    if (type === "DEDUCT" && wallet.balance < amount) {
      throw new AppError(400, "Insufficient balance");
    }

    const updated = await prisma.$transaction(async (tx) => {
      const balanceChange = type === "ADD" ? { increment: amount } : { decrement: amount };
      const totalEarnedChange = type === "ADD" ? { increment: amount } : undefined;

      await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          balance: balanceChange,
          ...(totalEarnedChange && { totalEarned: totalEarnedChange }),
        },
      });

      const transaction = await tx.transaction.create({
        data: {
          walletId: wallet.id,
          type: "ADJUSTMENT",
          amount: type === "ADD" ? amount : -amount,
          description,
          status: "COMPLETED",
        },
      });

      return { transaction };
    });

    return sendSuccess(res, {
      message: `Balance ${type === "ADD" ? "credited" : "debited"} successfully`,
      transaction: updated.transaction,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const getRiderEarnings = async (req: Request, res: Response) => {
  try {
    const { riderId } = req.params;
    const from = req.query.from ? new Date(req.query.from as string) : undefined;
    const to = req.query.to ? new Date(req.query.to as string) : undefined;

    const where: Record<string, unknown> = { riderId };
    if (from || to) {
      where.completedAt = {};
      if (from) (where.completedAt as Record<string, Date>).gte = from;
      if (to) (where.completedAt as Record<string, Date>).lte = to;
    }

    const [records, wallet] = await Promise.all([
      prisma.earningsRecord.findMany({
        where,
        orderBy: { completedAt: "desc" },
        include: { order: true },
      }),
      prisma.wallet.findUnique({
        where: { riderId },
      }),
    ]);

    const summary = {
      totalEarnings: records.reduce((sum, r) => sum + r.riderEarnings, 0),
      totalDeliveries: records.length,
      platformFees: records.reduce((sum, r) => sum + r.platformFee, 0),
      currentBalance: wallet?.balance || 0,
    };

    return sendSuccess(res, { records, summary });
  } catch (error) {
    return handleError(res, error);
  }
};

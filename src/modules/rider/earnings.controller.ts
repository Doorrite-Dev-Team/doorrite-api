import { Request, Response } from "express";
import prisma from "@config/db";
import { AppError, handleError, sendSuccess } from "@lib/utils/AppError";
import {
  EARNINGS_CONFIG,
  isFridayPayoutWindow,
  checkPeakHour,
} from "@services/earnings";
import { z } from "zod/v3";
import { getActorFromReq } from "@lib/utils/req-res";

const withdrawalSchema = z.object({
  amount: z.number().min(EARNINGS_CONFIG.MIN_WITHDRAWAL, `Minimum withdrawal is ₦${EARNINGS_CONFIG.MIN_WITHDRAWAL}`),
  bankName: z.string().min(1, "Bank name is required"),
  accountNumber: z.string().length(10, "Account number must be 10 digits"),
  accountName: z.string().min(1, "Account name is required"),
});

export const getEarningsSummary = async (req: Request, res: Response) => {
  try {
    const riderId = req.rider?.id;
    if (!riderId) {
      throw new AppError(401, "Authentication required");
    }

    const wallet = await prisma.wallet.findUnique({
      where: { riderId },
      include: {
        earningsRecords: true,
        payoutSchedules: true,
        transactions: true,
      },
    });

    if (!wallet) {
      throw new AppError(404, "Wallet not found");
    }

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const todayEarnings = await prisma.earningsRecord.aggregate({
      where: {
        riderId,
        completedAt: { gte: startOfDay },
      },
      _sum: { riderEarnings: true },
      _count: true,
    });

    const weekEarnings = await prisma.earningsRecord.aggregate({
      where: {
        riderId,
        completedAt: { gte: startOfWeek },
      },
      _sum: { riderEarnings: true },
      _count: true,
    });

    const monthEarnings = await prisma.earningsRecord.aggregate({
      where: {
        riderId,
        completedAt: { gte: startOfMonth },
      },
      _sum: { riderEarnings: true },
      _count: true,
    });

    const pendingPayout = await prisma.payoutSchedule.aggregate({
      where: {
        walletId: wallet.id,
        status: { in: ["PENDING", "APPROVED", "PROCESSING"] },
      },
      _sum: { amount: true },
    });

    return sendSuccess(res, {
      today: todayEarnings._sum.riderEarnings || 0,
      todayDeliveries: todayEarnings._count || 0,
      thisWeek: weekEarnings._sum.riderEarnings || 0,
      thisWeekDeliveries: weekEarnings._count || 0,
      thisMonth: monthEarnings._sum.riderEarnings || 0,
      thisMonthDeliveries: monthEarnings._count || 0,
      totalEarned: wallet.totalEarned,
      pendingPayout: pendingPayout._sum.amount || 0,
      availableBalance: wallet.balance,
      walletBalance: wallet.balance,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const getTransactions = async (req: Request, res: Response) => {
  try {
    const riderId = req.rider?.id;
    if (!riderId) {
      throw new AppError(401, "Authentication required");
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;
    const type = req.query.type as string;

    const wallet = await prisma.wallet.findUnique({
      where: { riderId },
    });

    if (!wallet) {
      throw new AppError(404, "Wallet not found");
    }

    const where: Record<string, unknown> = { walletId: wallet.id };
    if (type) {
      where.type = type;
    }

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.transaction.count({ where }),
    ]);

    return sendSuccess(res, {
      transactions,
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

export const getEarningsHistory = async (req: Request, res: Response) => {
  try {
    const riderId = req.rider?.id;
    if (!riderId) {
      throw new AppError(401, "Authentication required");
    }

    const from = req.query.from
      ? new Date(req.query.from as string)
      : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const to = req.query.to
      ? new Date(req.query.to as string)
      : new Date();

    const records = await prisma.earningsRecord.findMany({
      where: {
        riderId,
        completedAt: { gte: from, lte: to },
      },
      orderBy: { completedAt: "desc" },
    });

    const totalEarnings = records.reduce((sum, r) => sum + r.riderEarnings, 0);
    const totalDeliveries = records.length;
    const avgPerDelivery = totalDeliveries > 0 ? totalEarnings / totalDeliveries : 0;

    const peakEarnings = records
      .filter((r) => r.peakMultiplier > 1.0)
      .reduce((sum, r) => sum + r.riderEarnings, 0);

    return sendSuccess(res, {
      records,
      summary: {
        totalEarnings,
        totalDeliveries,
        avgPerDelivery,
        peakEarnings,
      },
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const requestWithdrawal = async (req: Request, res: Response) => {
  try {
    const riderId = req.rider?.id;
    if (!riderId) {
      throw new AppError(401, "Authentication required");
    }

    const parsed = withdrawalSchema.parse(req.body);
    const { amount, bankName, accountNumber, accountName } = parsed;

    const wallet = await prisma.wallet.findUnique({
      where: { riderId },
    });

    if (!wallet) {
      throw new AppError(404, "Wallet not found");
    }

    if (wallet.balance < amount) {
      throw new AppError(400, "Insufficient balance");
    }

    const isFriday = isFridayPayoutWindow();
    const requestType = isFriday ? "WEEKLY" : "INSTANT";
    const fee = isFriday ? 0 : EARNINGS_CONFIG.INSTANT_WITHDRAWAL_FEE;
    const totalDeduction = amount + fee;

    if (wallet.balance < totalDeduction) {
      throw new AppError(400, `Insufficient balance. Total deduction would be ₦${totalDeduction} (includes ₦${fee} fee)`);
    }

    const payout = await prisma.$transaction(async (tx) => {
      await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          balance: { decrement: totalDeduction },
          pendingBalance: { increment: amount },
        },
      });

      const transaction = await tx.transaction.create({
        data: {
          walletId: wallet.id,
          type: "PAYOUT",
          amount: -amount,
          description: `Withdrawal request to ${bankName} (${accountNumber})`,
          status: "PENDING",
        },
      });

      const schedule = await tx.payoutSchedule.create({
        data: {
          walletId: wallet.id,
          amount,
          requestType,
          status: "PENDING",
          scheduledDate: new Date(),
          bankName,
          accountNumber,
          accountName,
          transactionId: transaction.id,
        },
      });

      return { payout: schedule, transaction };
    });

    return sendSuccess(res, {
      withdrawalId: payout.payout.id,
      amount,
      status: "PENDING",
      estimatedProcessing: isFriday ? "This Friday" : "24-48 hours",
      feeApplied: fee,
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

export const getWithdrawalHistory = async (req: Request, res: Response) => {
  try {
    const riderId = req.rider?.id;
    if (!riderId) {
      throw new AppError(401, "Authentication required");
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const wallet = await prisma.wallet.findUnique({
      where: { riderId },
    });

    if (!wallet) {
      throw new AppError(404, "Wallet not found");
    }

    const [withdrawals, total] = await Promise.all([
      prisma.payoutSchedule.findMany({
        where: { walletId: wallet.id },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.payoutSchedule.count({
        where: { walletId: wallet.id },
      }),
    ]);

    return sendSuccess(res, {
      withdrawals,
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

export const getPayoutInfo = async (req: Request, res: Response) => {
  try {
    const riderId = req.rider?.id;
    if (!riderId) {
      throw new AppError(401, "Authentication required");
    }

    const wallet = await prisma.wallet.findUnique({
      where: { riderId },
      include: {
        payoutSchedules: {
          where: { status: { in: ["PENDING", "APPROVED", "PROCESSING"] } },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    if (!wallet) {
      throw new AppError(404, "Wallet not found");
    }

    const now = new Date();
    const nextFriday = new Date(now);
    const daysUntilFriday = (5 - now.getDay() + 7) % 7 || 7;
    nextFriday.setDate(now.getDate() + daysUntilFriday);
    nextFriday.setHours(0, 0, 0, 0);

    const pendingPayout = wallet.payoutSchedules[0];

    return sendSuccess(res, {
      nextPayoutDate: nextFriday.toISOString().split("T")[0],
      nextPayoutAmount: pendingPayout?.amount || 0,
      minimumBalance: EARNINGS_CONFIG.MIN_WITHDRAWAL,
      paymentMethod: null,
      autoPayoutEnabled: false,
      autoPayoutDay: "friday",
      walletBalance: wallet.balance,
      isFriday: isFridayPayoutWindow(),
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export const getMetrics = async (req: Request, res: Response) => {
  try {
    const riderId = req.rider?.id;
    if (!riderId) {
      throw new AppError(401, "Authentication required");
    }

    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    const [
      totalDeliveries,
      thisWeekStats,
      rider,
      ratings,
    ] = await Promise.all([
      prisma.earningsRecord.count({ where: { riderId } }),
      prisma.earningsRecord.aggregate({
        where: {
          riderId,
          completedAt: { gte: startOfWeek },
        },
        _sum: { riderEarnings: true },
        _count: true,
      }),
      prisma.rider.findUnique({
        where: { id: riderId },
        include: { reviews: true },
      }),
      prisma.review.aggregate({
        where: { riderId },
        _avg: { rating: true },
        _count: true,
      }),
    ]);

    const avgDeliveryTime = 22;

    return sendSuccess(res, {
      totalDeliveries,
      avgDeliveryTimeMinutes: avgDeliveryTime,
      rating: rider?.rating || ratings._avg.rating || 0,
      totalRatings: ratings._count || 0,
      thisWeek: {
        deliveries: thisWeekStats._count || 0,
        earnings: thisWeekStats._sum.riderEarnings || 0,
        avgTimeMinutes: avgDeliveryTime,
      },
    });
  } catch (error) {
    return handleError(res, error);
  }
};

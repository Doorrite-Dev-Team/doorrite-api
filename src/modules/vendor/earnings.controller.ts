import { Request, Response } from "express";
import prisma from "@config/db";
import { AppError, handleError, sendSuccess } from "@lib/utils/AppError";
import { getActorFromReq } from "@lib/utils/req-res";

export const getVendorEarningsSummary = async (req: Request, res: Response) => {
  try {
    const actor = getActorFromReq(req);
    if (!actor || actor.role !== "vendor") {
      throw new AppError(403, "Unauthorized");
    }

    const wallet = await prisma.wallet.findUnique({
      where: { vendorId: actor.id },
    });

    if (!wallet) {
      return sendSuccess(res, {
        balance: 0,
        pendingBalance: 0,
        totalEarnings: 0,
        totalWithdrawn: 0,
      });
    }

    return sendSuccess(res, {
      balance: wallet.balance,
      pendingBalance: wallet.pendingBalance,
      totalEarnings: wallet.totalEarned,
      totalWithdrawn: wallet.totalWithdrawn,
    });
  } catch (error) {
    handleError(res, error);
  }
};

export const getVendorTransactions = async (req: Request, res: Response) => {
  try {
    const actor = getActorFromReq(req);
    if (!actor || actor.role !== "vendor") {
      throw new AppError(403, "Unauthorized");
    }

    const { page = "1", limit = "20" } = req.query;
    const pageNum = Math.max(1, parseInt(page as string));
    const lim = Math.min(100, Math.max(1, parseInt(limit as string)));
    const skip = (pageNum - 1) * lim;

    const wallet = await prisma.wallet.findUnique({
      where: { vendorId: actor.id },
    });

    if (!wallet) {
      return sendSuccess(res, {
        transactions: [],
        pagination: { total: 0, page: pageNum, limit: lim },
      });
    }

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where: { walletId: wallet.id },
        orderBy: { createdAt: "desc" },
        skip,
        take: lim,
      }),
      prisma.transaction.count({ where: { walletId: wallet.id } }),
    ]);

    return sendSuccess(res, {
      transactions,
      pagination: { total, page: pageNum, limit: lim },
    });
  } catch (error) {
    handleError(res, error);
  }
};

export const requestVendorWithdrawal = async (req: Request, res: Response) => {
  try {
    const actor = getActorFromReq(req);
    if (!actor || actor.role !== "vendor") {
      throw new AppError(403, "Unauthorized");
    }

    const { amount, bankName, accountNumber, accountName } = req.body;

    if (!amount || amount <= 0) {
      throw new AppError(400, "Valid amount is required");
    }

    if (!bankName || !accountNumber || !accountName) {
      throw new AppError(400, "Bank details are required");
    }

    const wallet = await prisma.wallet.findUnique({
      where: { vendorId: actor.id },
    });

    if (!wallet || wallet.balance < amount) {
      throw new AppError(400, "Insufficient balance");
    }

    const MIN_WITHDRAWAL = 2000;
    if (amount < MIN_WITHDRAWAL) {
      throw new AppError(400, `Minimum withdrawal is ₦${MIN_WITHDRAWAL}`);
    }

    const transaction = await prisma.$transaction(async (tx) => {
      await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          balance: { decrement: amount },
          totalWithdrawn: { increment: amount },
        },
      });

      return tx.transaction.create({
        data: {
          walletId: wallet.id,
          type: "PAYOUT",
          amount: -amount,
          status: "PENDING",
          description: `Withdrawal request: ₦${amount} to ${bankName} (${accountNumber})`,
        },
      });
    });

    return sendSuccess(res, {
      message: "Withdrawal request submitted",
      transaction: {
        id: transaction.id,
        amount,
        status: transaction.status,
      },
    });
  } catch (error) {
    handleError(res, error);
  }
};

export const getVendorEarnings = async (req: Request, res: Response) => {
  try {
    const actor = getActorFromReq(req);
    if (!actor || actor.role !== "vendor") {
      throw new AppError(403, "Unauthorized");
    }

    const period = (req.query.period as "daily" | "weekly" | "monthly") || "weekly";
    const now = new Date();
    let startDate = new Date();

    if (period === "daily") {
      startDate.setDate(now.getDate() - 7);
    } else if (period === "weekly") {
      startDate.setDate(now.getDate() - 28);
    } else {
      startDate.setMonth(now.getMonth() - 3);
    }

    const wallet = await prisma.wallet.findUnique({
      where: { vendorId: actor.id },
    });

    if (!wallet) {
      return sendSuccess(res, {
        summary: { totalEarnings: 0, percentageChange: 0, period },
        wallet: { balance: 0, totalEarned: 0, totalWithdrawn: 0 },
        chartData: [],
        recentTransactions: [],
        pendingPayout: 0,
      });
    }

    const [periodEarnings, previousPeriodEarnings, transactions, pendingPayouts] =
      await Promise.all([
        prisma.transaction.aggregate({
          where: {
            walletId: wallet.id,
            type: "EARNING",
            createdAt: { gte: startDate },
          },
          _sum: { amount: true },
        }),
        prisma.transaction.aggregate({
          where: {
            walletId: wallet.id,
            type: "EARNING",
            createdAt: {
              gte: new Date(startDate.getTime() - (now.getTime() - startDate.getTime())),
            },
          },
          _sum: { amount: true },
        }),
        prisma.transaction.findMany({
          where: { walletId: wallet.id },
          orderBy: { createdAt: "desc" },
          take: 10,
        }),
        prisma.transaction.findMany({
          where: {
            walletId: wallet.id,
            type: "PAYOUT",
            status: "PENDING",
          },
        }),
      ]);

    const orderIds = transactions
      .map((tx) => tx.orderId)
      .filter((id): id is string => !!id);

    const orders = orderIds.length > 0
      ? await prisma.order.findMany({
          where: { id: { in: orderIds } },
          include: { customer: true },
        })
      : [];

    const orderMap = new Map(orders.map((o) => [o.id, o]));

    const currentTotal = periodEarnings._sum.amount ?? 0;
    const previousTotal = previousPeriodEarnings._sum.amount ?? 0;
    const percentageChange =
      previousTotal > 0
        ? Math.round(((currentTotal - previousTotal) / previousTotal) * 100 * 10) / 10
        : currentTotal > 0
          ? 100
          : 0;

    const chartData = await generateChartData(wallet.id, period, startDate);

    const totalPendingPayout =
      pendingPayouts.reduce((sum, tx) => sum + Math.abs(tx.amount), 0) || 0;

    return sendSuccess(res, {
      summary: { totalEarnings: currentTotal, percentageChange, period },
      wallet: {
        balance: wallet.balance,
        totalEarned: wallet.totalEarned,
        totalWithdrawn: wallet.totalWithdrawn,
      },
      chartData,
      recentTransactions: transactions.map((tx) => {
        const order = tx.orderId ? orderMap.get(tx.orderId) : undefined;
        return {
          id: tx.id,
          orderId: tx.orderId || undefined,
          customerName: order?.customer?.fullName || "N/A",
          customerAvatar: order?.customer?.profileImageUrl || null,
          amount: tx.amount,
          status: tx.status,
          createdAt: tx.createdAt.toISOString(),
        };
      }),
      pendingPayout: totalPendingPayout,
    });
  } catch (error) {
    handleError(res, error);
  }
};

async function generateChartData(
  walletId: string,
  period: "daily" | "weekly" | "monthly",
  startDate: Date,
) {
  const transactions = await prisma.transaction.findMany({
    where: {
      walletId,
      type: "EARNING",
      createdAt: { gte: startDate },
    },
    orderBy: { createdAt: "asc" },
  });

  const dataMap = new Map<string, number>();

  if (period === "daily") {
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      const key = d.toISOString().split("T")[0];
      dataMap.set(key, 0);
    }
    transactions.forEach((tx) => {
      const key = tx.createdAt.toISOString().split("T")[0];
      dataMap.set(key, (dataMap.get(key) || 0) + tx.amount);
    });
  } else if (period === "weekly") {
    for (let i = 0; i < 4; i++) {
      const d = new Date();
      d.setDate(d.getDate() - (3 - i) * 7);
      dataMap.set(`week${i + 1}`, 0);
    }
    const now = new Date();
    transactions.forEach((tx) => {
      const daysAgo =
        Math.floor(
          (now.getTime() - tx.createdAt.getTime()) / (1000 * 60 * 60 * 24),
        ) / 7;
      const week = Math.floor(daysAgo);
      if (week >= 0 && week < 4) {
        dataMap.set(
          `week${4 - week}`,
          (dataMap.get(`week${4 - week}`) || 0) + tx.amount,
        );
      }
    });
  } else {
    for (let i = 0; i < 3; i++) {
      const d = new Date();
      d.setMonth(d.getMonth() - (2 - i));
      const key = d.toISOString().slice(0, 7);
      dataMap.set(key, 0);
    }
    transactions.forEach((tx) => {
      const key = tx.createdAt.toISOString().slice(0, 7);
      dataMap.set(key, (dataMap.get(key) || 0) + tx.amount);
    });
  }

  return Array.from(dataMap.entries()).map(([date, amount]) => ({
    date,
    amount: Math.max(0, amount),
  }));
}

export const getVendorWithdrawalHistory = async (req: Request, res: Response) => {
  try {
    const actor = getActorFromReq(req);
    if (!actor || actor.role !== "vendor") {
      throw new AppError(403, "Unauthorized");
    }

    const { page = "1", limit = "20" } = req.query;
    const pageNum = Math.max(1, parseInt(page as string));
    const lim = Math.min(100, Math.max(1, parseInt(limit as string)));
    const skip = (pageNum - 1) * lim;

    const wallet = await prisma.wallet.findUnique({
      where: { vendorId: actor.id },
    });

    if (!wallet) {
      return sendSuccess(res, {
        withdrawals: [],
        pagination: { total: 0, page: pageNum, limit: lim },
      });
    }

    const [withdrawals, total] = await Promise.all([
      prisma.transaction.findMany({
        where: { walletId: wallet.id, type: "PAYOUT" },
        orderBy: { createdAt: "desc" },
        skip,
        take: lim,
      }),
      prisma.transaction.count({
        where: { walletId: wallet.id, type: "PAYOUT" },
      }),
    ]);

    return sendSuccess(res, {
      withdrawals,
      pagination: { total, page: pageNum, limit: lim },
    });
  } catch (error) {
    handleError(res, error);
  }
};

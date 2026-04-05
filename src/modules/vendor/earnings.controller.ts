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

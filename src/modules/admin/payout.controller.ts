import { Request, Response } from "express";
import prisma from "@config/db";
import { AppError, handleError, sendSuccess } from "@lib/utils/AppError";
import { z } from "zod/v3";

const payoutActionSchema = z.object({
  notes: z.string().optional(),
});

export const getAllPayouts = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Admin']
   * #swagger.summary = 'Get all payouts'
   * #swagger.description = 'Retrieves a paginated list of all payout schedules.'
   * #swagger.operationId = 'getAllPayouts'
   * #swagger.parameters['page'] = { in: 'query', description: 'Page number', type: 'integer', example: 1 }
   * #swagger.parameters['limit'] = { in: 'query', description: 'Items per page', type: 'integer', example: 20 }
   * #swagger.parameters['status'] = { in: 'query', description: 'Filter by payout status', type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED', 'COMPLETED'] }
   * #swagger.responses[200] = { description: 'Success', schema: { type: 'object', properties: { payouts: { type: 'array', items: { type: 'object' } }, pagination: { type: 'object' } } } }
   * #swagger.responses[401] = { description: 'Unauthorized', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } } }
   * #swagger.responses[500] = { description: 'Internal server error', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } } }
   */
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
  /**
   * #swagger.tags = ['Admin']
   * #swagger.summary = 'Get payout by ID'
   * #swagger.description = 'Retrieves detailed information about a specific payout schedule.'
   * #swagger.operationId = 'getPayoutById'
   * #swagger.parameters['id'] = { in: 'path', description: 'Payout ID', required: true, type: 'string' }
   * #swagger.responses[200] = { description: 'Success', schema: { type: 'object', properties: { payout: { type: 'object' } } } }
   * #swagger.responses[401] = { description: 'Unauthorized', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } } }
   * #swagger.responses[404] = { description: 'Payout not found', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } } }
   * #swagger.responses[500] = { description: 'Internal server error', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } } }
   */
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
  /**
   * #swagger.tags = ['Admin']
   * #swagger.summary = 'Approve payout'
   * #swagger.description = 'Approves a pending payout schedule.'
   * #swagger.operationId = 'approvePayout'
   * #swagger.parameters['id'] = { in: 'path', description: 'Payout ID', required: true, type: 'string' }
   * #swagger.parameters['body'] = { in: 'body', description: 'Approval notes', required: false, schema: { type: 'object', properties: { notes: { type: 'string', example: 'Approved after verification' } } } }
   * #swagger.responses[200] = { description: 'Success', schema: { type: 'object', properties: { payout: { type: 'object' }, message: { type: 'string' } } } }
   * #swagger.responses[400] = { description: 'Bad request', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } } }
   * #swagger.responses[401] = { description: 'Unauthorized', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } } }
   * #swagger.responses[404] = { description: 'Payout not found', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } } }
   * #swagger.responses[500] = { description: 'Internal server error', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } } }
   */
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
  /**
   * #swagger.tags = ['Admin']
   * #swagger.summary = 'Reject payout'
   * #swagger.description = 'Rejects a pending payout schedule and restores the balance to the rider.'
   * #swagger.operationId = 'rejectPayout'
   * #swagger.parameters['id'] = { in: 'path', description: 'Payout ID', required: true, type: 'string' }
   * #swagger.parameters['body'] = { in: 'body', description: 'Rejection notes', required: false, schema: { type: 'object', properties: { notes: { type: 'string', example: 'Incorrect bank details' } } } }
   * #swagger.responses[200] = { description: 'Success', schema: { type: 'object', properties: { message: { type: 'string' } } } }
   * #swagger.responses[400] = { description: 'Bad request', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } } }
   * #swagger.responses[401] = { description: 'Unauthorized', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } } }
   * #swagger.responses[404] = { description: 'Payout not found', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } } }
   * #swagger.responses[500] = { description: 'Internal server error', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } } }
   */
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
  /**
   * #swagger.tags = ['Admin']
   * #swagger.summary = 'Complete payout'
   * #swagger.description = 'Marks a payout as completed after payment has been processed externally.'
   * #swagger.operationId = 'completePayout'
   * #swagger.parameters['id'] = { in: 'path', description: 'Payout ID', required: true, type: 'string' }
   * #swagger.parameters['body'] = { in: 'body', description: 'Completion details', required: false, schema: { type: 'object', properties: { notes: { type: 'string' }, reference: { type: 'string', example: 'BANK_REF_12345' } } } }
   * #swagger.responses[200] = { description: 'Success', schema: { type: 'object', properties: { message: { type: 'string' }, reference: { type: 'string' } } } }
   * #swagger.responses[400] = { description: 'Bad request', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } } }
   * #swagger.responses[401] = { description: 'Unauthorized', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } } }
   * #swagger.responses[404] = { description: 'Payout not found', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } } }
   * #swagger.responses[500] = { description: 'Internal server error', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } } }
   */
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
  /**
   * #swagger.tags = ['Admin']
   * #swagger.summary = 'Adjust rider balance'
   * #swagger.description = 'Manually credit or debit a rider\'s wallet balance.'
   * #swagger.operationId = 'adjustRiderBalance'
   * #swagger.parameters['riderId'] = { in: 'path', description: 'Rider ID', required: true, type: 'string' }
   * #swagger.parameters['body'] = { in: 'body', description: 'Adjustment data', required: true, schema: { type: 'object', required: ['amount', 'type', 'description'], properties: { amount: { type: 'number', example: 1000 }, type: { type: 'string', enum: ['ADD', 'DEDUCT'], example: 'ADD' }, description: { type: 'string', example: 'Correction for order #123' } } } }
   * #swagger.responses[200] = { description: 'Success', schema: { type: 'object', properties: { message: { type: 'string' }, transaction: { type: 'object' } } } }
   * #swagger.responses[400] = { description: 'Bad request', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } } }
   * #swagger.responses[401] = { description: 'Unauthorized', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } } }
   * #swagger.responses[404] = { description: 'Wallet not found', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } } }
   * #swagger.responses[500] = { description: 'Internal server error', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } } }
   */
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
  /**
   * #swagger.tags = ['Admin']
   * #swagger.summary = 'Get rider earnings'
   * #swagger.description = 'Retrieves earnings records and summary for a specific rider.'
   * #swagger.operationId = 'getRiderEarnings'
   * #swagger.parameters['riderId'] = { in: 'path', description: 'Rider ID', required: true, type: 'string' }
   * #swagger.parameters['from'] = { in: 'query', description: 'Start date (ISO format)', type: 'string', example: '2024-01-01' }
   * #swagger.parameters['to'] = { in: 'query', description: 'End date (ISO format)', type: 'string', example: '2024-12-31' }
   * #swagger.responses[200] = { description: 'Success', schema: { type: 'object', properties: { records: { type: 'array', items: { type: 'object' } }, summary: { type: 'object' } } } }
   * #swagger.responses[401] = { description: 'Unauthorized', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } } }
   * #swagger.responses[500] = { description: 'Internal server error', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } } }
   */
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

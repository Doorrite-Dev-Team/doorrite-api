import prisma from "@config/db";
import { AppError, handleError, sendSuccess } from "@lib/utils/AppError";
import { getActorFromReq } from "@lib/utils/req-res";
import { generateReferralCode, generateReferralCodeFromPhone, applyReferralCode, getUserReferralStats, isEligibleForFreeDelivery } from "./referral.service";
import { Request, Response } from "express";

export const getMyReferralCode = async (req: Request, res: Response) => {
  try {
    const actor = getActorFromReq(req);
    if (!actor || !actor.id) throw new AppError(401, "Unauthorized");

    const user = await prisma.user.findUnique({
      where: { id: actor.id },
      select: { referralCode: true, freeDeliveryOrders: true, phoneNumber: true },
    });

    if (!user) throw new AppError(404, "User not found");

    let referralCode = user.referralCode;

    if (!referralCode) {
      const updated = await prisma.user.update({
        where: { id: actor.id },
        data: { referralCode: generateReferralCode() },
        select: { referralCode: true, freeDeliveryOrders: true },
      });
      referralCode = updated.referralCode;
    }

    return sendSuccess(res, {
      referralCode,
      freeDeliveryOrders: user.freeDeliveryOrders,
    });
  } catch (error) {
    handleError(res, error);
  }
};

export const applyCode = async (req: Request, res: Response) => {
  try {
    const actor = getActorFromReq(req);
    if (!actor || !actor.id) throw new AppError(401, "Unauthorized");

    const { code } = req.body;
    if (!code) throw new AppError(400, "Referral code is required");

    const user = await prisma.user.findUnique({
      where: { id: actor.id },
      select: { referralCode: true, referredBy: true, phoneNumber: true },
    });

    if (!user) throw new AppError(404, "User not found");

    if (user.referralCode === code) {
      throw new AppError(400, "Cannot use your own referral code");
    }

    if (user.referredBy) {
      throw new AppError(400, "You have already used a referral code");
    }

    const referrer = await prisma.user.findUnique({
      where: { referralCode: code },
      select: { id: true },
    });

    if (!referrer) {
      throw new AppError(400, "Invalid referral code");
    }

    await prisma.$transaction(async (tx) => {
      await applyReferralCode(actor.id, code, user.phoneNumber);

      await tx.user.update({
        where: { id: actor.id },
        data: { referredBy: referrer.id },
      });
    });

    return sendSuccess(res, {
      message: "Referral code applied successfully! You have 2 free delivery orders.",
      freeDeliveryOrders: 2,
    });
  } catch (error: any) {
    handleError(res, new AppError(400, error.message || "Failed to apply referral code"));
  }
};

export const getReferralStats = async (req: Request, res: Response) => {
  try {
    const actor = getActorFromReq(req);
    if (!actor || !actor.id) throw new AppError(401, "Unauthorized");

    const stats = await getUserReferralStats(actor.id);

    return sendSuccess(res, stats);
  } catch (error) {
    handleError(res, error);
  }
};

export const checkFreeDelivery = async (req: Request, res: Response) => {
  try {
    const actor = getActorFromReq(req);
    if (!actor || !actor.id) throw new AppError(401, "Unauthorized");

    const eligible = await isEligibleForFreeDelivery(actor.id);
    const user = await prisma.user.findUnique({
      where: { id: actor.id },
      select: { freeDeliveryOrders: true },
    });

    return sendSuccess(res, {
      eligibleForFreeDelivery: eligible,
      remainingFreeDeliveries: user?.freeDeliveryOrders || 0,
    });
  } catch (error) {
    handleError(res, error);
  }
};
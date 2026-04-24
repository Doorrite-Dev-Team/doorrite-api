import prisma from "@config/db";
import crypto from "crypto";

export const generateReferralCode = (): string => {
  const randomPart = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `DR-${randomPart}`;
};

export const generateReferralCodeFromPhone = (phoneNumber: string): string => {
  const hash = crypto.createHash("sha256").update(phoneNumber).digest("hex");
  return `DR-${hash.slice(0, 8).toUpperCase()}`;
};

export const applyReferralCode = async (
  userId: string,
  referralCode: string,
  phoneNumber: string
) => {
  const referrer = await prisma.user.findUnique({
    where: { referralCode },
  });

  if (!referrer) {
    throw new Error("Invalid referral code");
  }

  if (referrer.id === userId) {
    throw new Error("Cannot use your own referral code");
  }

  const existingReferral = await prisma.referral.findFirst({
    where: {
      refereePhone: phoneNumber,
      status: { not: "cancelled" },
    },
  });

  if (existingReferral) {
    throw new Error("This phone number has already used a referral code");
  }

  const referral = await prisma.referral.create({
    data: {
      referrerId: referrer.id,
      refereeId: userId,
      refereePhone: phoneNumber,
      status: "pending",
    },
  });

  return referral;
};

export const processReferralOnDelivery = async (orderId: string) => {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      customer: true,
    },
  });

  if (!order || order.status !== "DELIVERED") {
    return;
  }

  const pendingReferral = await prisma.referral.findFirst({
    where: {
      refereeId: order.customerId,
      status: "pending",
      refereeOrderId: null,
    },
  });

  if (pendingReferral) {
    await prisma.$transaction(async (tx) => {
      await tx.referral.update({
        where: { id: pendingReferral.id },
        data: {
          status: "completed",
          refereeOrderId: orderId,
        },
      });
    });
  }

  const completedRefereeReferrals = await prisma.referral.findFirst({
    where: {
      refereeId: order.customerId,
      status: "completed",
      referrerOrderId: null,
    },
  });

  if (completedRefereeReferrals) {
    await prisma.referral.update({
      where: { id: completedRefereeReferrals.id },
      data: {
        referrerOrderId: orderId,
      },
    });
  }
};

export const getUserReferralStats = async (userId: string) => {
  const [referralsMade, referralsReceived, user] = await Promise.all([
    prisma.referral.findMany({
      where: { referrerId: userId },
      orderBy: { createdAt: "desc" },
    }),
    prisma.referral.findMany({
      where: { refereeId: userId },
      orderBy: { createdAt: "desc" },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { referralCode: true, freeDeliveryOrders: true },
    }),
  ]);

  const totalEarned = referralsMade
    .filter((r) => r.status === "completed" && r.referrerOrderId)
    .length * 1000;

  return {
    referralCode: user?.referralCode,
    freeDeliveryOrders: user?.freeDeliveryOrders || 0,
    referralsMade: referralsMade.length,
    referralsReceived: referralsReceived.length,
    totalEarned,
    referrals: referralsMade,
  };
};

export const isEligibleForFreeDelivery = async (userId: string): Promise<boolean> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { freeDeliveryOrders: true },
  });
  return (user?.freeDeliveryOrders || 0) > 0;
};

export const useFreeDelivery = async (userId: string): Promise<void> => {
  await prisma.user.update({
    where: { id: userId },
    data: {
      freeDeliveryOrders: { decrement: 1 },
    },
  });
};
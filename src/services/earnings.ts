import prisma from "@config/db";
import { getDistance } from "@lib/utils/location";
import { GEOAPIFY_API_KEY } from "@config/env";

async function ensureWallet(ownerId: string, ownerType: "RIDER" | "VENDOR") {
  return prisma.wallet.upsert({
    where: { ownerId },
    update: {},
    create: { ownerId, ownerType },
  });
}

export const EARNINGS_CONFIG = {
  BASE_FEE: 200,
  PER_KM_RATE: 150,
  PLATFORM_FEE_PERCENT: 0.1,
  MIN_PAYOUT: 1000,
  MIN_WITHDRAWAL: 2000,
  INSTANT_WITHDRAWAL_FEE: 100,
  PEAK_MULTIPLIER: 1.5,
  PEAK_HOURS: [
    { start: 12, end: 15 },
    { start: 18, end: 21 },
  ],
  WAIT_FEE_PER_MINUTE: 20,
  WAIT_FEE_CAP: 500,
  MIN_WAIT_MINUTES: 15,
  SHORT_TRIP_MINIMUM: 800,
  VENDOR_COMMISSION_PERCENT: 0.15, // 15% platform fee
} as const;

export interface EarningsBreakdown {
  baseFee: number;
  distanceFee: number;
  distanceKm: number;
  peakMultiplier: number;
  peakBonus: number;
  waitTimeMinutes: number;
  waitTimeFee: number;
  subtotal: number;
  platformFee: number;
  riderEarnings: number;
}

export function checkPeakHour(date: Date = new Date()): boolean {
  const hours = date.getHours();

  for (const slot of EARNINGS_CONFIG.PEAK_HOURS) {
    if (hours >= slot.start && hours < slot.end) {
      return true;
    }
  }
  return false;
}

export function isFridayPayoutWindow(): boolean {
  const now = new Date();
  const day = now.getDay();
  const hour = now.getHours();

  if (day !== 5) return false;
  if (hour < 0 || hour >= 12) return false;
  return true;
}

export function calculateDistanceKm(
  pickup: { lat: number; long: number },
  dropoff: { lat: number; long: number },
): number {
  return getDistance(pickup.lat, pickup.long, dropoff.lat, dropoff.long);
}

export async function calculateEarnings(
  orderId: string,
  waitTimeMinutes: number = 0,
): Promise<EarningsBreakdown> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      delivery: true,
      vendor: true,
    },
  });

  if (!order) {
    throw new Error("Order not found");
  }

  // Try to get coordinates from delivery record, fallback to order's delivery address
  let pickupCoords: { lat: number; long: number } = { lat: 9.0, long: 7.0 }; // Default to Abuja
  let dropoffCoords: { lat: number; long: number } = { lat: 9.0, long: 7.0 };

  if (order.delivery) {
    const pickup = order.delivery.pickupLocation as {
      lat?: number;
      long?: number;
    } | null;
    const dropoff = order.delivery.dropoffLocation as {
      lat?: number;
      long?: number;
    } | null;
    pickupCoords = { lat: pickup?.lat ?? 9.0, long: pickup?.long ?? 7.0 };
    dropoffCoords = { lat: dropoff?.lat ?? 9.0, long: dropoff?.long ?? 7.0 };
  } else if (order.deliveryAddress) {
    const deliveryAddr = order.deliveryAddress as {
      coordinates?: { lat: number; long: number };
    };
    if (deliveryAddr.coordinates) {
      dropoffCoords = deliveryAddr.coordinates;
    }
    // Use vendor address as pickup if available
    const vendorAddr = order.vendor?.address as {
      coordinates?: { lat: number; long: number };
    } | null;
    if (vendorAddr?.coordinates) {
      pickupCoords = vendorAddr.coordinates;
    }
  }

  const distanceKm = calculateDistanceKm(pickupCoords, dropoffCoords);

  const isPeak = checkPeakHour(order.deliveredAt ?? new Date());
  const peakMultiplier = isPeak ? EARNINGS_CONFIG.PEAK_MULTIPLIER : 1.0;

  const baseFee = EARNINGS_CONFIG.BASE_FEE;
  const distanceFee = distanceKm * EARNINGS_CONFIG.PER_KM_RATE;

  let waitFee = 0;
  if (waitTimeMinutes > EARNINGS_CONFIG.MIN_WAIT_MINUTES) {
    const billableMinutes = waitTimeMinutes - EARNINGS_CONFIG.MIN_WAIT_MINUTES;
    waitFee = Math.min(
      billableMinutes * EARNINGS_CONFIG.WAIT_FEE_PER_MINUTE,
      EARNINGS_CONFIG.WAIT_FEE_CAP,
    );
  }

  const standardFee = baseFee + distanceFee + waitFee;
  const subtotal = standardFee * peakMultiplier;
  const platformFee = subtotal * EARNINGS_CONFIG.PLATFORM_FEE_PERCENT;
  let riderEarnings = subtotal - platformFee;

  if (riderEarnings < EARNINGS_CONFIG.SHORT_TRIP_MINIMUM) {
    riderEarnings = EARNINGS_CONFIG.SHORT_TRIP_MINIMUM;
  }

  return {
    baseFee,
    distanceFee,
    distanceKm,
    peakMultiplier,
    peakBonus: subtotal - standardFee,
    waitTimeMinutes: waitTimeMinutes,
    waitTimeFee: waitFee,
    subtotal,
    platformFee,
    riderEarnings,
  };
}

export async function createEarningsRecord(
  riderId: string,
  orderId: string,
  breakdown: EarningsBreakdown,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const wallet = await ensureWallet(riderId, "RIDER");

    if (!wallet) {
      throw new Error("Wallet not found for rider");
    }

    await tx.earningsRecord.create({
      data: {
        riderId,
        orderId,
        walletId: wallet.id,
        baseFee: breakdown.baseFee,
        distanceFee: breakdown.distanceFee,
        distanceKm: breakdown.distanceKm,
        peakMultiplier: breakdown.peakMultiplier,
        subtotal: breakdown.subtotal,
        platformFee: breakdown.platformFee,
        riderEarnings: breakdown.riderEarnings,
        waitTimeMinutes: breakdown.waitTimeMinutes,
        waitTimeFee: breakdown.waitTimeFee,
        completedAt: new Date(),
      },
    });

    await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        pendingBalance: { increment: breakdown.riderEarnings },
        totalEarned: { increment: breakdown.riderEarnings },
      },
    });

    await tx.transaction.create({
      data: {
        walletId: wallet.id,
        type: "EARNING",
        amount: breakdown.riderEarnings,
        description: `Delivery earnings for order ${orderId}`,
        orderId,
        breakdown: { ...breakdown } as any,
        status: "COMPLETED",
      },
    });
  });
}

export async function addRiderPendingEarnings(
  riderId: string,
  amount: number,
  orderId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const wallet = await ensureWallet(riderId, "RIDER");

    if (!wallet) {
      throw new Error("Wallet not found for rider");
    }

    await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        pendingBalance: { increment: amount },
      },
    });

    await tx.transaction.create({
      data: {
        walletId: wallet.id,
        type: "EARNING",
        amount: amount,
        description: `Pending delivery earnings for order ${orderId}`,
        orderId,
        status: "PENDING",
      },
    });
  });
}

export interface VendorEarningsBreakdown {
  orderSubtotal: number;
  platformFee: number;
  vendorEarnings: number;
}

export async function calculateVendorEarnings(
  orderId: string,
): Promise<VendorEarningsBreakdown> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
  });

  if (!order) {
    throw new Error("Order not found");
  }

  const orderItems = await prisma.orderItem.findMany({
    where: { orderId },
    include: { product: true },
  });

  const subtotal = orderItems.reduce((sum, item) => {
    return sum + item.price * item.quantity;
  }, 0);

  const platformFee = subtotal * EARNINGS_CONFIG.VENDOR_COMMISSION_PERCENT;
  const vendorEarnings = subtotal - platformFee;

  return {
    orderSubtotal: subtotal,
    platformFee,
    vendorEarnings,
  };
}

export async function creditVendorEarnings(orderId: string): Promise<void> {
  const breakdown = await calculateVendorEarnings(orderId);

  await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { vendor: true },
    });

    if (!order) {
      throw new Error("Order not found");
    }

    const wallet = await ensureWallet(order.vendorId, "VENDOR");

    await tx.transaction.create({
      data: {
        walletId: wallet.id,
        type: "EARNING",
        amount: breakdown.vendorEarnings,
        status: "PENDING",
        orderId,
        description: `Pending order earnings: ₦${breakdown.vendorEarnings.toFixed(2)} (Subtotal: ₦${breakdown.orderSubtotal}, Platform Fee: ₦${breakdown.platformFee.toFixed(2)})`,
      },
    });

    await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        pendingBalance: { increment: breakdown.vendorEarnings },
        // totalEarned: { increment: breakdown.vendorEarnings },
      },
    });
  });
}

export async function settleVendorEarnings(orderId: string): Promise<void> {
  const breakdown = await calculateVendorEarnings(orderId);
  const settleAmount = breakdown.vendorEarnings;

  await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { vendor: true },
    });

    if (!order) {
      throw new Error("Order not found");
    }

    const wallet = await ensureWallet(order.vendorId, "VENDOR");

    if (!wallet || wallet.pendingBalance < settleAmount) {
      return;
    }

    // Create completed transaction
    await tx.transaction.create({
      data: {
        walletId: wallet.id,
        type: "EARNING",
        amount: settleAmount,
        status: "COMPLETED",
        orderId,
        description: `Order earnings settled: ₦${settleAmount.toFixed(2)}`,
      },
    });

    // Move only the specific order's amount from pending to available
    await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        balance: { increment: settleAmount },
        pendingBalance: { decrement: settleAmount },
        totalEarned: { increment: breakdown.vendorEarnings },
      },
    });
  });
}

export async function settleRiderEarnings(orderId: string): Promise<void> {
  const breakdown = await calculateEarnings(orderId);
  const settleAmount = breakdown.riderEarnings;

  await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { rider: true },
    });

    if (!order || !order.riderId) {
      throw new Error("Order or rider not found");
    }

    const wallet = await ensureWallet(order.riderId, "RIDER");

    if (!wallet || wallet.pendingBalance < settleAmount) {
      return;
    }

    // Create completed transaction
    await tx.transaction.create({
      data: {
        walletId: wallet.id,
        type: "EARNING",
        amount: settleAmount,
        status: "COMPLETED",
        orderId,
        description: `Delivery earnings settled: ₦${settleAmount.toFixed(2)}`,
      },
    });

    // Move only the specific order's amount from pending to available
    await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        balance: { increment: settleAmount },
        pendingBalance: { decrement: settleAmount },
      },
    });
  });
}

export async function deductVendorEarnings(
  orderId: string,
  reason: string,
): Promise<void> {
  const breakdown = await calculateVendorEarnings(orderId);

  await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { vendor: true },
    });

    if (!order) {
      throw new Error("Order not found");
    }

    const wallet = await ensureWallet(order.vendorId, "VENDOR");

    if (!wallet) {
      return;
    }

    const deductAmount = Math.min(
      breakdown.vendorEarnings,
      wallet.pendingBalance + wallet.balance,
    );

    if (deductAmount > 0) {
      await tx.transaction.create({
        data: {
          walletId: wallet.id,
          type: "ADJUSTMENT",
          amount: -deductAmount,
          status: "COMPLETED",
          orderId,
          description: `Refund deducted: ${reason}`,
        },
      });

      if (wallet.pendingBalance >= deductAmount) {
        await tx.wallet.update({
          where: { id: wallet.id },
          data: {
            pendingBalance: { decrement: deductAmount },
          },
        });
      } else {
        const remaining = deductAmount - wallet.pendingBalance;
        await tx.wallet.update({
          where: { id: wallet.id },
          data: {
            pendingBalance: { decrement: wallet.pendingBalance },
            balance: { decrement: remaining },
          },
        });
      }
    }
  });
}

export async function getGeoapifyRouteDistance(
  pickup: [number, number],
  dropoff: [number, number],
): Promise<number> {
  if (!GEOAPIFY_API_KEY) {
    console.warn("GEOAPIFY_API_KEY not set, falling back to Haversine");
    return getDistance(pickup[0], pickup[1], dropoff[0], dropoff[1]);
  }

  const url = `https://api.geoapify.com/v1/routing?waypoints=${pickup.join(",")}|${dropoff.join(",")}&mode=motorcycle&apiKey=${GEOAPIFY_API_KEY}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.features && data.features.length > 0) {
      const distanceMeters = data.features[0].properties.distance;
      return distanceMeters / 1000;
    }

    console.warn(
      "Geoapify response missing features, falling back to Haversine",
    );
    return getDistance(pickup[0], pickup[1], dropoff[0], dropoff[1]);
  } catch (error) {
    console.error("Geoapify API error:", error);
    return getDistance(pickup[0], pickup[1], dropoff[0], dropoff[1]);
  }
}

export async function getAccurateDistance(
  pickup: { lat: number; long: number },
  dropoff: { lat: number; long: number },
  useGeoapify: boolean = false,
): Promise<number> {
  if (useGeoapify) {
    return getGeoapifyRouteDistance(
      [pickup.long, pickup.lat],
      [dropoff.long, dropoff.lat],
    );
  }

  return getDistance(pickup.lat, pickup.long, dropoff.lat, dropoff.long);
}

export async function addReferralBonus(
  riderId: string,
  referredByRiderId: string,
): Promise<void> {
  const bonusAmount = 1000;

  const wallet = await ensureWallet(riderId, "RIDER");

  if (!wallet) {
    throw new Error("Wallet not found for rider");
  }

  await prisma.$transaction(async (tx) => {
    await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        balance: { increment: bonusAmount },
        totalEarned: { increment: bonusAmount },
      },
    });

    await tx.transaction.create({
      data: {
        walletId: wallet.id,
        type: "BONUS",
        amount: bonusAmount,
        description: "Referral bonus - New rider signup",
        status: "COMPLETED",
      },
    });
  });
}

import prisma from "@config/db";
import { cacheService } from "@config/cache";
import { AppError } from "@lib/utils/AppError";

type AccountRole = "user" | "vendor" | "rider";

async function deleteUserCascade(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) throw new AppError(404, "User not found");

  const orders = await prisma.order.findMany({ where: { customerId: userId }, select: { id: true } });
  const orderIds = orders.map((o) => o.id);

  await prisma.$transaction([
    // OrderItem, OrderHistory, Payment, Delivery, EarningsRecord per order
    ...(orderIds.length > 0
      ? [
          prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } }),
          prisma.orderHistory.deleteMany({ where: { orderId: { in: orderIds } } }),
          prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } }),
          prisma.delivery.deleteMany({ where: { orderId: { in: orderIds } } }),
          prisma.earningsRecord.deleteMany({ where: { orderId: { in: orderIds } } }),
          prisma.order.deleteMany({ where: { customerId: userId } }),
        ]
      : []),
    // Reviews
    prisma.productReview.deleteMany({ where: { review: { userId } } }),
    prisma.review.deleteMany({ where: { userId } }),
    // Favorites
    prisma.favorite.deleteMany({ where: { userId } }),
    // Wallet + Transactions
    ...(await findAndDeleteWallet("USER", userId)),
    // Push subscriptions
    prisma.pushSubscription.deleteMany({ where: { userId, userType: "USER" } }),
    // Referrals
    prisma.referral.deleteMany({ where: { OR: [{ referrerId: userId }, { refereeId: userId }] } }),
    // Messages
    prisma.message.deleteMany({ where: { senderId: userId, senderType: "USER" } }),
    // User itself
    prisma.user.delete({ where: { id: userId } }),
  ]);

  await invalidateCaches("user", userId);
}

async function deleteVendorCascade(vendorId: string) {
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true } });
  if (!vendor) throw new AppError(404, "Vendor not found");

  const products = await prisma.product.findMany({ where: { vendorId }, select: { id: true } });
  const productIds = products.map((p) => p.id);

  const modifierGroups = await prisma.modifierGroup.findMany({ where: { vendorId }, select: { id: true } });
  const modifierGroupIds = modifierGroups.map((g) => g.id);

  const orders = await prisma.order.findMany({ where: { vendorId }, select: { id: true } });
  const orderIds = orders.map((o) => o.id);

  await prisma.$transaction([
    // Product-related
    ...(productIds.length > 0
      ? [
          prisma.productVariant.deleteMany({ where: { productId: { in: productIds } } }),
          prisma.productModifierGroup.deleteMany({ where: { productId: { in: productIds } } }),
        ]
      : []),
    prisma.product.deleteMany({ where: { vendorId } }),
    ...(modifierGroupIds.length > 0
      ? [prisma.modifierOption.deleteMany({ where: { modifierGroupId: { in: modifierGroupIds } } })]
      : []),
    prisma.modifierGroup.deleteMany({ where: { vendorId } }),
    // Orders from this vendor
    ...(orderIds.length > 0
      ? [
          prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } }),
          prisma.orderHistory.deleteMany({ where: { orderId: { in: orderIds } } }),
          prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } }),
          prisma.delivery.deleteMany({ where: { orderId: { in: orderIds } } }),
          prisma.earningsRecord.deleteMany({ where: { orderId: { in: orderIds } } }),
          prisma.order.deleteMany({ where: { vendorId } }),
        ]
      : []),
    // Reviews
    prisma.review.deleteMany({ where: { vendorId } }),
    // Wallet
    ...(await findAndDeleteWallet("VENDOR", vendorId)),
    // Push subscriptions
    prisma.pushSubscription.deleteMany({ where: { userId: vendorId, userType: "VENDOR" } }),
    // Vendor itself
    prisma.vendor.delete({ where: { id: vendorId } }),
  ]);

  await invalidateCaches("vendor", vendorId);
}

async function deleteRiderCascade(riderId: string) {
  const rider = await prisma.rider.findUnique({ where: { id: riderId }, select: { id: true } });
  if (!rider) throw new AppError(404, "Rider not found");

  await prisma.$transaction([
    // Deliveries
    prisma.delivery.deleteMany({ where: { riderId } }),
    // Earnings
    prisma.earningsRecord.deleteMany({ where: { riderId } }),
    // Reviews
    prisma.review.deleteMany({ where: { riderId } }),
    // Wallet
    ...(await findAndDeleteWallet("RIDER", riderId)),
    // Push subscriptions
    prisma.pushSubscription.deleteMany({ where: { userId: riderId, userType: "RIDER" } }),
    // Rider itself
    prisma.rider.delete({ where: { id: riderId } }),
  ]);

  await invalidateCaches("rider", riderId);
}

async function findAndDeleteWallet(ownerType: "USER" | "VENDOR" | "RIDER", ownerId: string) {
  const wallet = await prisma.wallet.findUnique({ where: { ownerId } });
  if (!wallet) return [];

  return [
    prisma.transaction.deleteMany({ where: { walletId: wallet.id } }),
    prisma.payoutSchedule.deleteMany({ where: { walletId: wallet.id } }),
    prisma.wallet.delete({ where: { id: wallet.id } }),
  ];
}

async function invalidateCaches(role: AccountRole, id: string) {
  const prefix = role === "vendor" ? "vendor" : role === "rider" ? "rider" : "users";
  await cacheService.invalidate(cacheService.generateKey(prefix, id));
  await cacheService.invalidate(cacheService.generateKey(prefix, `profile_${id}`));
  await cacheService.invalidatePattern(`${prefix}*`);
}

export const deleteAccount = async (role: AccountRole, id: string) => {
  switch (role) {
    case "user":
      await deleteUserCascade(id);
      break;
    case "vendor":
      await deleteVendorCascade(id);
      break;
    case "rider":
      await deleteRiderCascade(id);
      break;
    default:
      throw new AppError(400, "Invalid account role");
  }
};

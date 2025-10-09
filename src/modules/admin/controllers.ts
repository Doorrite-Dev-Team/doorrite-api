import { Request, Response } from "express";
import prisma from "@config/db";
import { AppError, handleError, sendSuccess } from "@lib/utils/AppError";
import { verifyPassword } from "@lib/hash";
import { setAuthCookies } from "@config/cookies";
import { makeAccessTokenForUser, makeRefreshTokenForUser } from "@config/jwt";
import socketService from "@lib/socketService";
// import { getActorFromReq } from "@lib/utils/req-res";

// POST /admin/login
export const adminLogin = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password)
      throw new AppError(400, "Email and password are required");

    const admin = await prisma.user.findFirst({
      where: { email, role: "ADMIN" },
      select: { id: true, email: true, passwordHash: true, fullName: true },
    });

    if (!admin) throw new AppError(401, "Invalid credentials");

    const ok = await verifyPassword(admin.passwordHash, password);
    if (!ok) throw new AppError(401, "Invalid credentials");

    const access = makeAccessTokenForUser(admin.id, "admin");
    const refresh = makeRefreshTokenForUser(admin.id);

    setAuthCookies(res, access, refresh, "user");

    return sendSuccess(
      res,
      {
        user: { id: admin.id, email: admin.email, fullName: admin.fullName },
        access,
      },
      200
    );
  } catch (err: any) {
    return handleError(res, err);
  }
};

// GET /admin/vendors
export const listVendors = async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const skip = (page - 1) * limit;

    const [total, vendors] = await Promise.all([
      prisma.vendor.count(),
      prisma.vendor.findMany({
        take: limit,
        skip,
        orderBy: { createdAt: "desc" },
      }),
    ]);

    return sendSuccess(res, { vendors, total, page, limit });
  } catch (err: any) {
    return handleError(res, err);
  }
};

// GET /admin/vendors/:vendorId
export const getVendor = async (req: Request, res: Response) => {
  try {
    const { vendorId } = req.params;
    if (!vendorId) throw new AppError(400, "vendorId required");

    const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor) throw new AppError(404, "Vendor not found");

    return sendSuccess(res, { vendor });
  } catch (err: any) {
    return handleError(res, err);
  }
};

// PATCH /admin/vendors/:vendorId/approve
export const approveVendor = async (req: Request, res: Response) => {
  try {
    const { vendorId } = req.params;
    if (!vendorId) throw new AppError(400, "vendorId required");

    const vendor = await prisma.vendor.update({
      where: { id: vendorId },
      data: { isVerified: true, isActive: true },
    });

    return sendSuccess(res, { vendor });
  } catch (err: any) {
    return handleError(res, err);
  }
};

// PATCH /admin/orders/:orderId/status
export const updateOrderStatus = async (req: Request, res: Response) => {
  try {
    const { orderId } = req.params;
    const { status } = req.body;
    if (!orderId) throw new AppError(400, "orderId required");
    if (!status) throw new AppError(400, "status required");

    const order = await prisma.order.update({
      where: { id: orderId },
      data: { status },
    });

    // Emit order update
    try {
      socketService.emitOrderUpdate(order);
    } catch (e: Error | any) {
      console.warn("Failed to emit order update:", e?.message || e);
    }

    return sendSuccess(res, { order });
  } catch (err: any) {
    return handleError(res, err);
  }
};

// GET /admin/reports
export const getReports = async (req: Request, res: Response) => {
  try {
    // MVP reports: counts and simple revenue
    const [usersCount, vendorsCount, ordersCount, revenue] = await Promise.all([
      prisma.user.count(),
      prisma.vendor.count(),
      prisma.order.count(),
      prisma.order.aggregate({
        _sum: { totalAmount: true },
        where: { paymentStatus: "SUCCESSFUL" },
      }),
    ]);

    return sendSuccess(res, {
      usersCount,
      vendorsCount,
      ordersCount,
      revenue: revenue._sum,
    });
  } catch (err: any) {
    return handleError(res, err);
  }
};

// ===== Rider administration =====
// GET /admin/riders
export const listRiders = async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const skip = (page - 1) * limit;

    const [total, riders] = await Promise.all([
      prisma.rider.count(),
      prisma.rider.findMany({
        take: limit,
        skip,
        orderBy: { createdAt: "desc" },
      }),
    ]);

    return sendSuccess(res, { riders, total, page, limit });
  } catch (err: any) {
    return handleError(res, err);
  }
};

// GET /admin/riders/:riderId
export const getRider = async (req: Request, res: Response) => {
  try {
    const { riderId } = req.params;
    if (!riderId) throw new AppError(400, "riderId required");

    const rider = await prisma.rider.findUnique({ where: { id: riderId } });
    if (!rider) throw new AppError(404, "Rider not found");

    return sendSuccess(res, { rider });
  } catch (err: any) {
    return handleError(res, err);
  }
};

// PATCH /admin/riders/:riderId/approve
export const approveRider = async (req: Request, res: Response) => {
  try {
    const { riderId } = req.params;
    if (!riderId) throw new AppError(400, "riderId required");

    const rider = await prisma.rider.update({
      where: { id: riderId },
      data: { isVerified: true, isAvailable: true },
    });

    return sendSuccess(res, { rider });
  } catch (err: any) {
    return handleError(res, err);
  }
};

// PATCH /admin/riders/:riderId/suspend
export const suspendRider = async (req: Request, res: Response) => {
  try {
    const { riderId } = req.params;
    if (!riderId) throw new AppError(400, "riderId required");

    const rider = await prisma.rider.update({
      where: { id: riderId },
      data: { isAvailable: false },
    });

    return sendSuccess(res, { rider });
  } catch (err: any) {
    return handleError(res, err);
  }
};

export default {
  adminLogin,
  listVendors,
  getVendor,
  approveVendor,
  updateOrderStatus,
  getReports,
};

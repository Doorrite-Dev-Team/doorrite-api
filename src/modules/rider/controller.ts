import { Request, Response } from "express";
import prisma from "@config/db";
import { AppError, handleError, sendSuccess } from "@lib/utils/AppError";
import { isValidNigerianPhone } from "@modules/auth/helper";
import { $Enums } from "../../generated/prisma";
import { getActorFromReq } from "@lib/utils/req-res";
import socketService from "@lib/socketService";

type LocationUpdate = {
  latitude: number;
  longitude: number;
  updatedAt: Date;
};

// Get Rider by ID
// GET /riders/:id
export const getRiderById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const rider = await prisma.rider.findUnique({
      where: { id },
      include: {
        reviews: true,
      },
    });
    if (!rider) throw new AppError(404, "Rider not found");

    return sendSuccess(res, { rider });
  } catch (error) {
    return handleError(res, error);
  }
};

// Get Current Rider Profile
// GET /riders/me
export const getCurrentRiderProfile = async (req: Request, res: Response) => {
  try {
    const riderId = req.rider?.id; // Assuming rider ID is available from auth middleware
    if (!riderId) {
      throw new AppError(401, "Authentication required");
    }

    const rider = await prisma.rider.findUnique({
      where: { id: riderId },
      include: {
        orders: true,
      },
    });

    if (!rider) {
      throw new AppError(404, "Rider not found");
    }

    return sendSuccess(res, { rider });
  } catch (error) {
    handleError(res, error);
  }
};

// Get All Riders with Pagination
// Get /riders
export const getAllRiders = async (req: Request, res: Response) => {
  try {
    const { page = "1", limit = "20" } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page));
    const lim = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * lim;

    const [riders, total] = await Promise.all([
      prisma.rider.findMany({
        take: lim,
        skip,
        orderBy: { createdAt: "desc" },
      }),
      prisma.rider.count(),
    ]);
    return sendSuccess(res, {
      riders,
      pagination: { total, page: pageNum, limit: lim },
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// Update Rider Profile
// PUT api/v1/riders/me
export const updateRiderProfile = async (req: Request, res: Response) => {
  const riderId = req.rider?.id;
  if (!riderId) throw new AppError(401, "Authentication required");

  const allowedFields = [
    "fullName",
    "phoneNumber",
    "profileImageUrl",
    "vehicleType",
    "licenseNumber",
    "currentLocation",
    "address",
  ];

  const data: Record<string, any> = {};
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      data[field] = req.body[field];
    }
  }

  if (Object.keys(data).length === 0) {
    throw new AppError(400, "No valid update fields provided");
  }

  // Extra validation example

  const errors: string[] = [];

  if (data.fullName && data.fullName.trim().length === 0) {
    errors.push("Full name cannot be empty");
  }

  if (
    (data.licenseNumber && typeof data.licenseNumber !== "string") ||
    data.licenseNumber.trim().length === 0
  ) {
    errors.push("License number must be a non-empty string");
  }

  if (
    (data.address && typeof data.address !== "object") ||
    Array.isArray(data.address)
  ) {
    errors.push("Address must be a valid JSON object");
  }

  if (
    data.vehicleType &&
    !Object.values($Enums.VehicleType).includes(data.vehicleType)
  ) {
    errors.push("Invalid vehicle type");
  }

  if (data.phoneNumber && !isValidNigerianPhone(data.phoneNumber)) {
    errors.push("Invalid phone number format");
  }

  if (data.currentLocation && typeof data.currentLocation !== "object") {
    errors.push("Current location must be a valid JSON object");
  }

  if (data.profileImageUrl && typeof data.profileImageUrl !== "string") {
    errors.push("Profile image URL must be a string");
  }

  if (errors.length > 0) {
    throw new AppError(400, errors.join(", "));
  }

  const updatedRider = await prisma.rider.update({
    where: { id: riderId },
    data,
  });

  return sendSuccess(res, {
    message: "Rider updated successfully",
    rider: updatedRider,
  });
};

/**
 * @desc    Get orders assigned to rider or available for claiming
 * @route   GET /api/rider/orders
 * @access  Private - Rider only
 */
export const getRiderOrders = async (req: Request, res: Response) => {
  try {
    const riderId = req.rider?.id;
    if (!riderId) throw new AppError(401, "Unauthorized");

    const {
      page = "1",
      limit = "20",
      status,
      claimable = "false",
    } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page));
    const lim = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * lim;

    const where: any =
      claimable === "true"
        ? {
            riderId: null,
            status: { in: ["ACCEPTED", "PREPARING"] },
          }
        : {
            riderId,
            ...(status ? { status } : {}),
          };

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        take: lim,
        skip,
        orderBy: { createdAt: "desc" },
        include: {
          items: { include: { product: true, variant: true } },
          customer: { select: { id: true, fullName: true, email: true } },
          vendor: { select: { id: true, businessName: true } },
          delivery: true,
          history: { orderBy: { createdAt: "desc" } },
        },
      }),
      prisma.order.count({ where }),
    ]);

    return sendSuccess(res, {
      orders,
      total,
      page: pageNum,
      limit: lim,
    });
  } catch (err) {
    return handleError(res, err);
  }
};

// Get rider's order by ID
// GET /api/v1/riders/orders/:id
export const getRiderOrderById = async (req: Request, res: Response) => {
  try {
    const riderId = req.rider?.id;
    if (!riderId) throw new AppError(401, "Authentication required");
    const actor = getActorFromReq(req);
    if (actor.role !== "RIDER" && actor.role !== "ADMIN") {
      throw new AppError(403, "Forbidden: Access is denied");
    }
    const { id } = req.params;
    const order = await prisma.order.findUnique({
      where: { id },
      include: { items: true, customer: true, vendor: true, rider: true },
    });
    if (!order) throw new AppError(404, "Order not found");
    if (actor.role === "RIDER" && order.riderId !== riderId) {
      throw new AppError(403, "You do not have access to this order");
    }
    return sendSuccess(res, { order });
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * @desc    Claim an order for delivery
 * @route   POST /api/rider/claim/:id/
 * @access  Private - Rider only
 */
export const claimOrder = async (req: Request, res: Response) => {
  const { id } = req.params;
  const actor = getActorFromReq(req);

  try {
    if (!id) throw new AppError(400, "Order id is required");
    if (!actor?.id) throw new AppError(401, "Unauthorized");
    if (actor.role !== "RIDER")
      throw new AppError(403, "Only riders can claim orders");

    const result = await prisma.$transaction(async (tx) => {
      // atomic guarded update: only update when riderId is null AND order in claimable status
      const updateRes = await tx.order.updateMany({
        where: {
          id,
          riderId: null,
          status: { in: ["ACCEPTED", "PREPARING"] },
        },
        data: {
          riderId: actor.id,
          status: "OUT_FOR_DELIVERY",
        },
      });

      if (updateRes.count === 0) {
        throw new AppError(409, "Order already claimed or not claimable");
      }

      await tx.orderHistory.create({
        data: {
          orderId: id,
          status: "OUT_FOR_DELIVERY",
          actorId: actor.id,
          actorType: "RIDER",
          note: "Rider claimed the order",
        },
      });

      const order = await tx.order.findUnique({
        where: { id },
        include: {
          items: { include: { product: true, variant: true } },
          history: { orderBy: { createdAt: "desc" } },
          vendor: { select: { id: true, businessName: true } },
          customer: { select: { id: true, fullName: true } },
        },
      });

      return { success: true, order };
    });

    return sendSuccess(res, { order: result?.order });
  } catch (err) {
    return handleError(res, err);
  }
};

/**
 * @desc    Update rider's current location
 * @route   POST /api/rider/location
 * @access  Private - Rider only
 */
export const updateLocation = async (req: Request, res: Response) => {
  const { latitude, longitude } = req.body;
  const riderId = req.rider?.id;

  try {
    if (!riderId) throw new AppError(401, "Unauthorized");
    if (typeof latitude !== "number" || typeof longitude !== "number")
      throw new AppError(
        400,
        "Latitude and longitude are required and must be numbers"
      );

    // Persist coordinates inside the rider.address.coordinates if address exists
    const rider = await prisma.rider.findUnique({ where: { id: riderId } });
    if (!rider) throw new AppError(404, "Rider not found");

    const addressUpdate: any = {};
    if (rider.address) {
      addressUpdate.address = rider.address.address || "";
      addressUpdate.city = rider.address.city || undefined;
      addressUpdate.state = rider.address.state || undefined;
      addressUpdate.lga = rider.address.lga || undefined;
      addressUpdate.postalCode = rider.address.postalCode || undefined;
      addressUpdate.coordinates = { lat: latitude, long: longitude };
    }

    const data: any = {};
    if (rider.address) {
      data.address = addressUpdate;
    } else {
      // no address object yet; set a minimal address container with coordinates
      data.address = {
        address: "",
        coordinates: { lat: latitude, long: longitude },
        country: "Nigeria",
      } as any;
    }

    await prisma.rider.update({ where: { id: riderId }, data });

    // Notify connected clients about this rider's new location
    if (data.address?.coordinates) {
      socketService.updateRiderLocation(riderId, {
        lat: data.address.coordinates.lat,
        long: data.address.coordinates.long,
      });
    }

    return sendSuccess(res, { message: "Location updated successfully" });
  } catch (err) {
    return handleError(res, err);
  }
};

/**
 * @desc    Toggle rider's availability status
 * @route   PATCH /api/rider/availability
 * @access  Private - Rider only
 */
export const toggleAvailability = async (req: Request, res: Response) => {
  const { available } = req.body;
  const riderId = req.rider?.id;

  try {
    if (!riderId) throw new AppError(401, "Unauthorized");
    if (typeof available !== "boolean")
      throw new AppError(400, "Available status must be boolean");

    const rider = await prisma.rider.update({
      where: { id: riderId },
      data: { isAvailable: available },
      select: { id: true, isAvailable: true },
    });

    return sendSuccess(res, {
      message: `Rider is now ${
        rider.isAvailable ? "available" : "unavailable"
      }`,
      rider,
    });
  } catch (err) {
    return handleError(res, err);
  }
};

/**
 * @desc    Get rider's delivery history with pagination
 * @route   GET /api/rider/history/?page=&limit=&from=&to=
 * @access  Private - Rider only
 */
export const getDeliveryHistory = async (req: Request, res: Response) => {
  const riderId = req.rider?.id;
  const {
    page = "1",
    limit = "20",
    from,
    to,
  } = req.query as Record<string, string>;

  try {
    if (!riderId) throw new AppError(401, "Unauthorized");

    const pageNum = Math.max(1, parseInt(page));
    const lim = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * lim;

    const where: any = {
      riderId,
      status: "DELIVERED",
    };

    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const [deliveries, total] = await Promise.all([
      prisma.order.findMany({
        where,
        take: lim,
        skip,
        orderBy: { createdAt: "desc" },
        include: {
          items: { include: { product: true } },
          vendor: { select: { id: true, businessName: true } },
          customer: { select: { id: true, fullName: true } },
          history: {
            where: { actorType: "RIDER" },
            orderBy: { createdAt: "desc" },
          },
        },
      }),
      prisma.order.count({ where }),
    ]);

    return sendSuccess(res, {
      deliveries,
      total,
      page: pageNum,
      limit: lim,
    });
  } catch (err) {
    return handleError(res, err);
  }
};

// Decline Order
// POST /api/v1/riders/orders/:id/decline

/**
 * @desc    POST rider declines an assigned order
 * @route   POST /api/rider/decline/:id/
 * @access  Private - Rider only
 */
export const declineOrder = async (req: Request, res: Response) => {
  try {
    const riderId = req.rider?.id;
    if (!riderId) throw new AppError(401, "Authentication required");
    // const actor = getActorFromReq(req);
    // if (actor.role !== "RIDER") {
    //   throw new AppError(403, "Only riders can decline orders");
    // }
    const { id } = req.params;
    if (!id) throw new AppError(400, "Order id is required");
    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) throw new AppError(404, "Order not found");
    if (order.riderId && order.riderId !== riderId) {
      throw new AppError(400, "Order already claimed by another rider");
    }
    if (!["ACCEPTED", "PREPARING"].includes(order.status)) {
      throw new AppError(400, "Order is not in a declinable status");
    }
    const updatedOrder = await prisma.order.update({
      where: { id },
      data: { riderId: null },
    });
    // await prisma.orderHistory.create({
    //   data: {
    //     orderId: id,
    //     status: order.status,
    //     actorId: riderId,
    //     actorType: "RIDER",
    //     note: "Rider declined the order",
    //   },
    // });
    return sendSuccess(res, { order: updatedOrder });
  } catch (error) {
    return handleError(res, error);
  }
};

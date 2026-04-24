import { Request, Response } from "express";
import prisma from "@config/db";
import { AppError, handleError, sendSuccess } from "@lib/utils/AppError";
import { isValidNigerianPhone } from "@modules/auth/helper";
import { $Enums } from "../../generated/prisma";
import { getActorFromReq } from "@lib/utils/req-res";
import { socketService } from "@config/socket";
import { addressSchema } from "@lib/utils/address";
import { createOCCode } from "@config/redis";
import { AppSocketEvent } from "constants/socket";
import { PendingReviewService } from "@services/redis/pending-review";
import { calculateEarnings, settleVendorEarnings, addRiderPendingEarnings } from "@services/earnings";
import { cacheService } from "@config/cache";
import { pushService } from "@modules/push/push.service";
import { processReferralOnDelivery } from "@modules/referral/referral.service";

type LocationUpdate = {
  latitude: number;
  longitude: number;
  updatedAt: Date;
};

// Get Rider by ID
// GET /riders/:orderId
export const getRiderById = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Rider']
   * #swagger.summary = 'Get a single rider by ID'
   * #swagger.description = 'Retrieves public information about a specific rider.'
   * #swagger.operationId = 'getRiderById'
   * #swagger.security = [{ "bearerAuth": [] }]
   * #swagger.parameters['id'] = { in: 'path', description: 'Rider ID', required: true, type: 'string', example: 'rider_123' }
   * #swagger.responses[200] = { description: 'Rider retrieved successfully', schema: { type: 'object', properties: { rider: { type: 'object' } } } }
   * #swagger.responses[404] = { description: 'Rider not found', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
   * #swagger.responses[500] = { description: 'Internal server error', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
   */
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
  /**
   * #swagger.tags = ['Rider']
   * #swagger.summary = 'Get current rider profile'
   * #swagger.description = 'Retrieves the profile of the currently authenticated rider.'
   * #swagger.operationId = 'getCurrentRiderProfile'
   * #swagger.security = [{ "bearerAuth": [] }]
   * #swagger.responses[200] = { description: 'Profile retrieved successfully', schema: { type: 'object', properties: { rider: { type: 'object' } } } }
   * #swagger.responses[401] = { description: 'Unauthorized', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
   * #swagger.responses[500] = { description: 'Internal server error', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
   */
  try {
    const riderId = req.user?.sub;
    if (!riderId) {
      throw new AppError(401, "Authentication required");
    }

    const rider = await prisma.rider.findUnique({
      where: { id: riderId },
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
// Get /riders/?page=&limit=
export const getAllRiders = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Rider']
   * #swagger.summary = 'Get all riders'
   * #swagger.description = 'Retrieves a paginated list of all riders.'
   * #swagger.operationId = 'getAllRiders'
   * #swagger.security = [{ "bearerAuth": [] }]
   * #swagger.parameters['page'] = { in: 'query', description: 'Page number', required: false, type: 'integer', example: 1 }
   * #swagger.parameters['limit'] = { in: 'query', description: 'Number of items per page', required: false, type: 'integer', example: 20 }
   * #swagger.responses[200] = { description: 'Riders retrieved successfully', schema: { type: 'object', properties: { riders: { type: 'array' }, total: { type: 'integer' }, page: { type: 'integer' }, limit: { type: 'integer' } } }}
   * #swagger.responses[500] = { description: 'Internal server error', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
   */
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
  /**
   * #swagger.tags = ['Rider']
   * #swagger.summary = 'Update rider profile'
   * #swagger.description = 'Updates the profile of the currently authenticated rider.'
   * #swagger.operationId = 'updateRiderProfile'
   * #swagger.security = [{ "bearerAuth": [] }]
    * #swagger.requestBody = { description: 'Rider profile data', required: true, schema: { type: 'object', properties: { fullName: { type: 'string' }, phoneNumber: { type: 'string' }, profileImageUrl: { type: 'string' }, vehicleType: { type: 'string' }, licenseNumber: { type: 'string' }, currentLocation: { type: 'object' }, address: { type: 'object' } } } }
   * #swagger.responses[200] = { description: 'Profile updated successfully', schema: { type: 'object', properties: { rider: { type: 'object' } } } }
   * #swagger.responses[400] = { description: 'Invalid request', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
   * #swagger.responses[401] = { description: 'Unauthorized', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
   * #swagger.responses[500] = { description: 'Internal server error', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
   */
  const riderId = req.user?.sub;
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
    data.licenseNumber &&
    (typeof data.licenseNumber !== "string" ||
      data.licenseNumber.trim().length === 0)
  ) {
    errors.push("License number must be a non-empty string");
  }

  if (data.address && !addressSchema.safeParse(data.address).success) {
    errors.push("Invalid address format");
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
  /**
   * #swagger.tags = ['Rider']
   * #swagger.summary = 'Get rider orders'
   * #swagger.description = 'Retrieves a list of orders for the rider. Can be filtered by status or to show claimable orders.'
   * #swagger.operationId = 'getRiderOrders'
   * #swagger.security = [{ "bearerAuth": [] }]
   * #swagger.parameters['page'] = { in: 'query', description: 'Page number', required: false, type: 'integer' }
   * #swagger.parameters['limit'] = { in: 'query', description: 'Number of items per page', required: false, type: 'integer' }
   * #swagger.parameters['status'] = { in: 'query', description: 'Filter by order status', required: false, type: 'string' }
* #swagger.parameters['claimable'] = { in: 'query', description: 'Set to true to get claimable orders', required: false, type: 'boolean' }
    * #swagger.responses[200] = { description: 'Success', schema: { type: 'object', properties: { orders: { type: 'array' }, total: { type: 'integer' }, page: { type: 'integer' }, limit: { type: 'integer' } } }}
    * #swagger.responses[401] = { description: 'Unauthorized', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
    * #swagger.responses[404] = { description: 'Not found', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
    * #swagger.responses[500] = { description: 'Internal server error', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
    */
  try {
    const riderId = req.user?.sub;
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
// GET /api/v1/riders/orders/:orderId
export const getRiderOrderById = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Rider']
   * #swagger.summary = 'Get a specific order by ID'
   * #swagger.description = 'Retrieves details of a specific order assigned to the rider.'
* #swagger.operationId = 'getRiderOrderById'
    * #swagger.security = [{ "bearerAuth": [] }]
    * #swagger.parameters['id'] = { in: 'path', description: 'Order ID', required: true, type: 'string' }
    * #swagger.responses[200] = { description: 'Success', schema: { type: 'object', properties: { order: { type: 'object' } } }}
    * #swagger.responses[401] = { description: 'Unauthorized', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
    * #swagger.responses[404] = { description: 'Not found', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
    * #swagger.responses[500] = { description: 'Internal server error', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
    */
  try {
    const riderId = req.user?.sub;
    if (!riderId) throw new AppError(401, "Authentication required");
    const actor = getActorFromReq(req);
    const role = String(actor.role || "").toUpperCase();
    if (role !== "RIDER" && role !== "ADMIN") {
      throw new AppError(403, "Forbidden: Access is denied");
    }
    const { orderId: id } = req.params;
    const order = await prisma.order.findUnique({
      where: { id },
      include: { items: true, customer: true, vendor: true, rider: true },
    });
    if (!order) throw new AppError(404, "Order not found");
    if (role !== "ADMIN" && order.riderId !== riderId) {
      throw new AppError(403, "You do not have access to this order");
    }
    return sendSuccess(res, { order });
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * @desc    Claim an order for delivery
 * @route   POST /api/rider/orders/:orderId/claim
 * @access  Private - Rider only
 */
export const claimOrder = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Rider']
   * #swagger.summary = 'Claim an order'
   * #swagger.description = 'Allows a rider to claim an available order for delivery.'
* #swagger.operationId = 'claimOrder'
    * #swagger.security = [{ "bearerAuth": [] }]
    * #swagger.parameters['id'] = { in: 'path', description: 'Order ID', required: true, type: 'string' }
    * #swagger.responses[200] = { description: 'Success', schema: { type: 'object', properties: { order: { type: 'object' } } }}
    * #swagger.responses[400] = { description: 'Bad request', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
    * #swagger.responses[401] = { description: 'Unauthorized', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
    * #swagger.responses[403] = { description: 'Forbidden', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
    * #swagger.responses[404] = { description: 'Not found', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
    * #swagger.responses[500] = { description: 'Internal server error', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
    */
  const { orderId: id } = req.params;
  const actor = getActorFromReq(req);

  try {
    if (!id) throw new AppError(400, "Order id is required");
    if (!actor) throw new AppError(401, "Unauthorized");
    const role = String(actor.role || "").toUpperCase();
    if (role !== "RIDER")
      throw new AppError(403, "Only riders can claim orders");

    console.log("[CLAIM] actor:", actor);
    console.log("[CLAIM] orderId:", id);

    const order = await prisma.order.findUnique({
      where: { id },
    });
    console.log("[CLAIM] order:", order?.id, order?.status, order?.riderId);
    if (!order) throw new AppError(404, "Order Does not Exist");

    const result = await prisma.$transaction(async (tx) => {
      // MongoDB fix: query by status only, then check riderId in application code
      // Prisma MongoDB has issues with null filter in where clause
      const availableOrder = await tx.order.findFirst({
        where: {
          id,
          status: { in: ["ACCEPTED", "PREPARING", "READY_FOR_PICKUP"] },
        },
      });

      // Check riderId in application code (works around Prisma MongoDB bug)
      if (!availableOrder || availableOrder.riderId !== null) {
        throw new AppError(409, "Order already claimed or not claimable");
      }

      console.log(
        "[CLAIM] availableOrder:",
        availableOrder?.id,
        availableOrder?.status,
        availableOrder?.riderId,
      );

      // Now update the order
      await tx.order.update({
        where: { id: availableOrder.id },
        data: {
          riderId: actor.id,
          status: "OUT_FOR_DELIVERY",
        },
      });

      // Create Delivery record for earnings calculation
      const vendor = await tx.vendor.findUnique({
        where: { id: availableOrder.vendorId },
        select: { address: true },
      });

      const vendorAddress = vendor?.address as {
        coordinates?: { lat: number; long: number };
      } | null;
      const deliveryAddressCoords = availableOrder.deliveryAddress as {
        coordinates?: { lat: number; long: number };
      } | null;

      await tx.delivery.create({
        data: {
          orderId: id,
          riderId: actor.id,
          pickupLocation: vendorAddress?.coordinates ?? { lat: 9.0, long: 7.0 },
          dropoffLocation: deliveryAddressCoords?.coordinates ?? {
            lat: 9.0,
            long: 7.0,
          },
          status: "PICKED_UP",
        },
      });

      // Add rider pending earnings (delivery fee)
      try {
        const breakdown = await calculateEarnings(id);
        await addRiderPendingEarnings(actor.id, breakdown.riderEarnings, id);
        console.log("[CLAIM] Rider pending earnings added:", breakdown.riderEarnings);
      } catch (earningsError) {
        console.error("[CLAIM] Failed to add rider pending earnings:", earningsError);
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
          rider: { select: { id: true, fullName: true } },
        },
      });

      return { success: true, order };
    });

    // Send push notification to customer when rider claims the order
    if (result?.order?.customerId) {
      pushService.sendToUser(result.order.customerId, {
        title: "Rider Assigned",
        body: `A rider is on the way to pick up your order from ${result.order.vendor?.businessName}`,
        tag: `order-${result.order.id}`,
        data: {
          orderId: result.order.id,
          vendorId: result.order.vendorId,
          status: "OUT_FOR_DELIVERY",
        },
      }).catch((err) => console.error("Push notification failed:", err));
    }

    // Send push notification to vendor when order is claimed
    if (result?.order?.vendorId) {
      pushService.sendToVendor(result.order.vendorId, {
        title: "Order Claimed",
        body: `Order ${result.order.id.slice(-6)} has been claimed by a rider`,
        tag: `order-${result.order.id}`,
        data: {
          orderId: result.order.id,
          riderId: actor.id,
        },
      }).catch((err) => console.error("Push notification to vendor failed:", err));
    }

    return sendSuccess(res, { order: result?.order });
  } catch (err) {
    return handleError(res, err);
  }
};

/**
 * @desc    Generate 6 digit code for order confirmation
 * @route   GET /api/rider/orders/:orderId/gen-code
 * @access  Private - Rider only
 */
export const generateVendorOrderCode = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Rider']
   * #swagger.summary = 'Generate 6 digit code for order confirmation'
   * #swagger.description = 'Used for Verifying if the rider is the actual rider.'
* #swagger.operationId = 'generateVendorOrderCode'
    * #swagger.security = [{ "bearerAuth": [] }]
    * #swagger.parameters['id'] = { in: 'path', description: 'Order ID', required: true, type: 'string' }
    * #swagger.responses[200] = { description: 'Success', schema: { type: 'object', properties: { code: { type: 'string' }, expiresIn: { type: 'integer' } } }}
    * #swagger.responses[400] = { description: 'Bad request', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
    * #swagger.responses[401] = { description: 'Unauthorized', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
    * #swagger.responses[403] = { description: 'Forbidden', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
    * #swagger.responses[404] = { description: 'Not found', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
    * #swagger.responses[500] = { description: 'Internal server error', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
    */
  try {
    const { orderId: id } = req.params;
    const actor = getActorFromReq(req);

    if (!id) throw new AppError(400, "Order id is required");
    if (!actor) throw new AppError(401, "Unauthorized");
    const role = String(actor.role || "").toUpperCase();
    if (role !== "RIDER")
      throw new AppError(403, "Only riders can claim orders");

    const order = await prisma.order.findUnique({
      where: { id },
    });
    if (!order) throw new AppError(404, "Order Does not Exist");
    if (order.riderId !== actor.id) throw new AppError(401, "Unauthorize");

    const data = await createOCCode(order.riderId, order.vendorId, order.id);
    if (!data.ok) throw new AppError(500, "Error Generating Code");

    return sendSuccess(res, { ...data });
  } catch (error) {
    handleError(res, error);
  }
};

/**
 * @desc    Verify 6 digit code to complete delivery (for rider)
 * @route   POST /api/v1/riders/orders/:orderId/verify-delivery
 * @access  Private - Rider only
 */

export const verifyCustomerDelivery = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Rider']
   * #swagger.summary = 'Verify 6 digit code to complete delivery'
   * #swagger.description = 'Used by the rider to submit the code received from the customer.'
   * #swagger.operationId = 'verifyCustomerDelivery'
   * #swagger.security = [{ "bearerAuth": [] }]
   * #swagger.parameters['orderId'] = { in: 'path', description: 'Order ID', required: true, type: 'string' }
    * #swagger.requestBody = {}
   * in: 'body',
   * description: 'Scanned verification code',
   * required: true,
   * schema: {
   * type: 'object',
   * properties: {
   * scannedCode: { type: 'string', example: '123456' }
   * }
* }
    * }
    * #swagger.responses[200] = { description: 'Success', schema: { type: 'object', properties: { message: { type: 'string' } } }}
    * #swagger.responses[400] = { description: 'Bad request', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
    * #swagger.responses[401] = { description: 'Unauthorized', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
    * #swagger.responses[403] = { description: 'Forbidden', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
    * #swagger.responses[404] = { description: 'Not found', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
    * #swagger.responses[500] = { description: 'Internal server error', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
    */

  try {
    const { orderId } = req.params;
    const { scannedCode } = req.body;
    const actor = getActorFromReq(req);

    if (!orderId) throw new AppError(400, "Order ID is required");
    if (!scannedCode) throw new AppError(400, "Verification code is required");
    if (!actor) throw new AppError(401, "Unauthorized");
    const role = String(actor.role || "").toUpperCase();
    if (role !== "RIDER")
      throw new AppError(403, "Only riders can verify deliveries");

    const code = scannedCode.trim();

    const order = await prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) throw new AppError(404, "Order not found");
    if (order.riderId !== actor.id)
      throw new AppError(403, "You are not the assigned rider for this order");

    if (order.status !== "OUT_FOR_DELIVERY") {
      throw new AppError(
        400,
        "This order is not currently out for delivery. Current status: " +
          order.status,
      );
    }

    if (!order.deliveryVerificationCode) {
      throw new AppError(
        500,
        "Verification code has not been generated for this order.",
      );
    }
    // The core verification check
    if (order.deliveryVerificationCode !== code) {
      throw new AppError(400, "Invalid verification code");
    }

    // Success! Update order status and nullify the code so it can't be reused.
    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data: {
        status: "DELIVERED",
        deliveryVerificationCode: null,
      },
      include: {
        customer: { select: { id: true, fullName: true } },
        vendor: { select: { id: true, businessName: true } },
        rider: { select: { id: true, fullName: true } },
      },
    });

    socketService.notify(
      updatedOrder.customerId,
      AppSocketEvent.ORDER_DELIVERED,
      {
        title: "Order Delivered",
        type: "ORDER_DELIVERED",
        message: `Your order has been delivered! Rate your experience.`,
        priority: "high",
        metadata: {
          orderId: updatedOrder.id,
          vendorId: updatedOrder.vendorId,
        },
        timestamp: new Date().toISOString(),
      },
    );

    // Send push notification to customer
    if (updatedOrder.customerId) {
      pushService.sendToUser(updatedOrder.customerId, {
        title: "Order Delivered",
        body: `Your order has been delivered! Rate your experience.`,
        tag: `order-delivered-${updatedOrder.id}`,
        data: {
          orderId: updatedOrder.id,
          vendorId: updatedOrder.vendorId,
          status: "DELIVERED",
        },
      }).catch((err) => console.error("Push notification failed:", err));
    }

    // Send push notification to vendor
    if (updatedOrder.vendorId) {
      pushService.sendToVendor(updatedOrder.vendorId, {
        title: "Order Delivered",
        body: `Order ${updatedOrder.id.slice(-6)} has been delivered`,
        tag: `order-delivered-${updatedOrder.id}`,
        data: {
          orderId: updatedOrder.id,
          riderId: updatedOrder.riderId,
        },
      }).catch((err) => console.error("Push to vendor failed:", err));
    }

    // Send push notification to rider
    if (updatedOrder.riderId) {
      pushService.sendToRider(updatedOrder.riderId, {
        title: "Delivery Complete",
        body: `Order ${updatedOrder.id.slice(-6)} has been delivered. Great job!`,
        tag: `delivery-complete-${updatedOrder.id}`,
        data: {
          orderId: updatedOrder.id,
        },
      }).catch((err) => console.error("Push to rider failed:", err));
    }

    await PendingReviewService.add(orderId, updatedOrder.customerId);

    try {
      await calculateEarnings(orderId);
    } catch (err) {
      console.error("Failed to calculate rider earnings:", err);
    }

    try {
      await settleVendorEarnings(orderId);
    } catch (err) {
      console.error("Failed to settle vendor earnings:", err);
    }

    try {
      await processReferralOnDelivery(orderId);
    } catch (err) {
      console.error("Failed to process referral:", err);
    }

    await cacheService.invalidatePattern("orders");
    await cacheService.invalidatePattern("userOrders");

    return sendSuccess(res, { message: "Delivery successfully verified" });
  } catch (error) {
    handleError(res, error);
  }
};

// /**
//  * @desc    Update rider's current location
//  * @route   POST /api/rider/location
//  * @access  Private - Rider only
//  */
// export const updateLocation = async (req: Request, res: Response) => {
//   /**
//    * #swagger.tags = ['Rider']
//    * #swagger.summary = 'Update rider location'
//    * #swagger.description = 'Updates the real-time location of the rider.'
//    * #swagger.security = [{ "bearerAuth": [] }]
 //    * #swagger.requestBody = { description: 'Location data', required: true, schema: { type: 'object', properties: { latitude: { type: 'number' }, longitude: { type: 'number' } } } }
//    */
//   const { latitude, longitude } = req.body;
//   const riderId = req.user?.sub;

//   try {
//     if (!riderId) throw new AppError(401, "Unauthorized");
//     if (typeof latitude !== "number" || typeof longitude !== "number")
//       throw new AppError(
//         400,
//         "Latitude and longitude are required and must be numbers"
//       );

//     // Persist coordinates inside the rider.address.coordinates if address exists
//     const rider = await prisma.rider.findUnique({ where: { id: riderId } });
//     if (!rider) throw new AppError(404, "Rider not found");

//     const addressUpdate: any = {};
//     if (rider.address) {
//       addressUpdate.address = rider.address.address || "";
//       addressUpdate.state = rider.address.state || "ilorin";
//       addressUpdate.coordinates = { lat: latitude, long: longitude };
//     }

//     const data: any = {};
//     if (rider.address) {
//       data.address = addressUpdate;
//     } else {
//       // no address object yet; set a minimal address container with coordinates
//       data.address = {
//         address: "",
//         coordinates: { lat: latitude, long: longitude },
//         country: "Nigeria",
//       } as any;
//     }

//     await prisma.rider.update({ where: { id: riderId }, data });

//     // Notify connected clients about this rider's new location
//     if (data.address?.coordinates) {
//       socketService.updateRiderLocation(riderId, {
//         lat: data.address.coordinates.lat,
//         long: data.address.coordinates.long,
//       });
//     }

//     return sendSuccess(res, { message: "Location updated successfully" });
//   } catch (err) {
//     return handleError(res, err);
//   }
// };

/**
 * @desc    Toggle rider's availability status
 * @route   PATCH /api/rider/availability
 * @access  Private - Rider only
 */
export const toggleAvailability = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Rider']
   * #swagger.summary = 'Toggle rider availability'
   * #swagger.description = 'Sets the rider as available or unavailable for new orders.'
* #swagger.operationId = 'toggleAvailability'
    * #swagger.security = [{ "bearerAuth": [] }]
     * #swagger.requestBody = { description: 'Availability status', required: true, schema: { type: 'object', properties: { isAvailable: { type: 'boolean' } } }}
    * #swagger.responses[200] = { description: 'Success', schema: { type: 'object', properties: { message: { type: 'string' }, rider: { type: 'object' } } }}
    * #swagger.responses[401] = { description: 'Unauthorized', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
    * #swagger.responses[404] = { description: 'Not found', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
    * #swagger.responses[500] = { description: 'Internal server error', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
    */
  const available = req.body?.isAvailable ?? req.body?.available;
  const riderId = req.user?.sub;

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
  /**
   * #swagger.tags = ['Rider']
   * #swagger.summary = 'Get delivery history'
   * #swagger.description = 'Retrieves the delivery history for the authenticated rider.'
* #swagger.operationId = 'getDeliveryHistory'
    * #swagger.security = [{ "bearerAuth": [] }]
    * #swagger.parameters['page'] = { in: 'query', description: 'Page number', required: false, type: 'integer' }
    * #swagger.parameters['limit'] = { in: 'query', description: 'Number of items per page', required: false, type: 'integer' }
    * #swagger.parameters['from'] = { in: 'query', description: 'Start date for filtering', required: false, type: 'string', format: 'date-time' }
    * #swagger.parameters['to'] = { in: 'query', description: 'End date for filtering', required: false, type: 'string', format: 'date-time' }
    * #swagger.responses[200] = { description: 'Success', schema: { type: 'object', properties: { deliveries: { type: 'array' }, total: { type: 'integer' }, page: { type: 'integer' }, limit: { type: 'integer' } } }}
    * #swagger.responses[401] = { description: 'Unauthorized', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
    * #swagger.responses[404] = { description: 'Not found', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
    * #swagger.responses[500] = { description: 'Internal server error', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
    */
  const riderId = req.user?.sub;
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
// POST /api/v1/riders/orders/:orderId/decline

/**
 * @desc    POST rider declines an assigned order
 * @route   POST /api/rider/orders/:orderId/decline
 * @access  Private - Rider only
 */
export const declineOrder = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Rider']
   * #swagger.summary = 'Decline an order'
   * #swagger.description = 'Allows a rider to decline an assigned order.'
* #swagger.operationId = 'declineOrder'
    * #swagger.security = [{ "bearerAuth": [] }]
    * #swagger.parameters['id'] = { in: 'path', description: 'Order ID', required: true, type: 'string' }
    * #swagger.responses[200] = { description: 'Success', schema: { type: 'object', properties: { order: { type: 'object' } } }}
    * #swagger.responses[400] = { description: 'Bad request', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
    * #swagger.responses[401] = { description: 'Unauthorized', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
    * #swagger.responses[403] = { description: 'Forbidden', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
    * #swagger.responses[404] = { description: 'Not found', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
    * #swagger.responses[500] = { description: 'Internal server error', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
    */
  try {
    const riderId = req.user?.sub;
    if (!riderId) throw new AppError(401, "Authentication required");
    // const actor = getActorFromReq(req);
    // if (actor.role !== "rider") {
    //   throw new AppError(403, "Only riders can decline orders");
    // }
    const { orderId: id } = req.params;
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

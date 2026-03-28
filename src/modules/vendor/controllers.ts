import prisma from "@config/db";
// import socketService from "@lib/socketService";
import { AppError, handleError, sendSuccess } from "@lib/utils/AppError";
import { isValidNigerianPhone } from "@modules/auth/helper";
import { isValidObjectId } from "@modules/product/helpers";
import { Request, Response } from "express";
import { addressSchema } from "@lib/utils/address";
import { verifyOCCode } from "@config/redis";
import { getActorFromReq } from "@lib/utils/req-res";
import { AppSocketEvent } from "constants/socket";
import { socketService } from "@config/socket";
import { cacheService } from "@config/cache";
import { Vendor } from "generated/prisma";
import {
  calculateDeliveryTime,
  calculateDeliveryFee,
  calculateIsOpen,
  calculateDistance,
} from "@lib/utils/location";

//Get Vendor Details
//GET /api/vendors/:id
export const getVendorById = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor']
   * #swagger.summary = 'Get vendor details'
   * #swagger.description = 'Fetches a single vendor by their ID.'
   */
  try {
    const vendorId = req.params.id;

    if (!isValidObjectId(vendorId)) {
      throw new AppError(400, "Invalid vendor ID");
    }

    const key = cacheService.generateKey("vendors", vendorId);
    const cacheHit = await cacheService.get<{ vendor: Vendor }>(key);

    if (cacheHit) {
      console.debug(
        "--------------------------------Cache----------------------------",
      );
      return sendSuccess(res, cacheHit);
    }

    console.debug(
      "--------------------------------Missed----------------------------",
    );

    const vendor = await prisma.vendor.findUnique({
      where: { id: vendorId },
      include: {
        products: true,
        reviews: true,
      },
    });

    if (!vendor) {
      throw new AppError(404, "Vendor not found");
    }

    const data = { vendor };
    console.debug(
      "--------------------------------Adding to Cache----------------------------",
    );
    await cacheService.set(key, data);

    return sendSuccess(res, data);
  } catch (error) {
    handleError(res, error);
  }
};

//Get Current Vendor Profile
//GET /api/vendors/me
export const getCurrentVendorProfile = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor']
   * #swagger.summary = "Get current vendor's profile"
   * #swagger.description = 'Fetches the profile of the currently authenticated vendor, including their products and orders.'
   */
  try {
    const vendorId = req.user?.sub; // Assuming vendor ID is available from auth middleware
    if (!vendorId) {
      throw new AppError(401, "Authentication required");
    }

    const key = cacheService.generateKey("vendors", `profile_${vendorId}`);
    const cacheHit = await cacheService.get<{ vendor: Vendor }>(key);

    if (cacheHit) {
      console.debug(
        "--------------------------------Cache----------------------------",
      );
      return sendSuccess(res, cacheHit);
    }

    console.debug(
      "--------------------------------Missed----------------------------",
    );

    const vendor = await prisma.vendor.findUnique({
      where: { id: vendorId },
      include: {
        products: true,
        orders: true,
        wallet: true,
      },
    });

    if (!vendor) {
      throw new AppError(404, "Vendor not found");
    }

    const data = { vendor };
    console.debug(
      "--------------------------------Adding to Cache----------------------------",
    );
    await cacheService.set(key, data);

    return sendSuccess(res, data);
  } catch (error) {
    handleError(res, error);
  }
};

//Get All Vendors with pagination
//GET /api/vendors
export const getAllVendors = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor']
   * #swagger.summary = 'Get all vendors with pagination'
   * #swagger.description = 'Fetches a paginated list of all vendors.'
   * #swagger.parameters['page'] = { in: 'query', description: 'Page number', type: 'integer' }
   * #swagger.parameters['limit'] = { in: 'query', description: 'Number of items per page', type: 'integer' }
   */
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;
    const totalVendors = await prisma.vendor.count();
    const totalPages = Math.ceil(totalVendors / limit);

    const key = cacheService.generateKey(
      "vendors",
      `${page}_${limit}_${offset}`,
    );
    const cacheHit = await cacheService.get<{
      vendors: Vendor[];
      pagination: {
        totalVendors: number;
        totalPages: number;
        currentPage: number;
        pageSize: number;
      };
    }>(key);

    if (cacheHit) {
      console.debug(
        "--------------------------------Cache Hits----------------------------",
        key,
      );

      return sendSuccess(res, cacheHit);
    }

    console.debug(
      "--------------------------------Missed----------------------------",
    );

    const vendors = await prisma.vendor.findMany({
      skip: offset,
      take: limit,
      include: {
        products: true,
        reviews: true,
      },
    });
    if (!vendors) {
      throw new AppError(404, "Vendors not found");
    }

    const data = {
      vendors: vendors.map((v) => {
        return { ...v, isOpen: false };
      }),
      pagination: {
        totalVendors,
        totalPages,
        currentPage: page,
        pageSize: limit,
      },
    };

    console.debug(
      "--------------------------------Adding to Cache----------------------------",
    );
    await cacheService.set(key, data);

    return sendSuccess(res, data);
  } catch (error) {
    handleError(res, error);
  }
};

export const getAllVendorsV2 = async (req: Request, res: Response) => {
  try {
    const {
      page = "1",
      limit = "20",
      q, // Search vendor name
      cuisine, // Filter by cuisine/category
      open, // Filter by open/closed
      sort = "recommended", // Sort option
      freeDelivery, // Filter free delivery (NEW FIELD NEEDED)
      fastDelivery, // Filter fast delivery
      topRated, // Filter top rated (4.5+)
      priceRange, // budget/mid/premium
      lat, // User latitude for distance calculation
      lng, // User longitude
    } = req.query;

    const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
    const limitNum = Math.min(
      100,
      Math.max(1, parseInt(String(limit), 10) || 20),
    );

    const where: any = {
      isActive: true,
      isVerified: true,
      isApproved: true, // Only show approved vendors
    };

    // 1. SEARCH BY VENDOR NAME
    if (q && typeof q === "string" && q.trim().length) {
      where.businessName = {
        contains: q.trim(),
        mode: "insensitive",
      };
    }

    // 2. FILTER BY CUISINE/CATEGORY
    if (cuisine && typeof cuisine === "string" && cuisine !== "all") {
      // categories is String[] in schema
      where.categories = {
        has: cuisine, // Check if array contains this cuisine
      };
    }

    // 3. FILTER BY OPEN/CLOSED (needs calculation)
    // NOTE: This requires runtime calculation based on openingTime/closingTime
    // We'll handle this AFTER fetching vendors (see below)

    // 4. FILTER BY TOP RATED
    if (topRated === "true") {
      where.rating = { gte: 4.5 };
    }

    // 5. FILTER BY PRICE RANGE (NEW FIELD NEEDED IN SCHEMA)
    // You'll need to add a 'priceRange' field to Vendor schema
    // OR calculate it based on average product prices
    if (priceRange && priceRange !== "all") {
      // Option A: Add field to schema
      // where.priceRange = priceRange;
      // Option B: Calculate from products (more accurate but slower)
      // Skip for now, handle in frontend
    }

    // 6. SORTING
    let orderBy: any = {};
    switch (sort) {
      case "rating":
        orderBy = { rating: "desc" };
        break;
      case "distance":
        // Handle distance sorting separately (needs lat/lng calculation)
        orderBy = { createdAt: "desc" }; // Fallback
        break;
      case "delivery_time":
        orderBy = { avrgPreparationTime: "asc" }; // Sort by prep time
        break;
      case "price_low":
      case "price_high":
        // Would need average product price calculation
        orderBy = { createdAt: "desc" }; // Fallback
        break;
      case "popular":
        // Would need order count calculation
        orderBy = { createdAt: "desc" }; // Fallback
      case "recommended":
      default:
        // ML-based or composite score
        orderBy = { rating: "desc" }; // Simple fallback
        break;
    }

    // FETCH VENDORS
    const [vendors, total] = await Promise.all([
      prisma.vendor.findMany({
        where,
        include: {
          products: {
            where: { isAvailable: true },
            select: { id: true, basePrice: true }, // For price range calc
            take: 5, // Just get a few for calculations
          },
          reviews: {
            select: { rating: true },
            take: 1, // Just to check if reviews exist
          },
        },
        orderBy,
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
      prisma.vendor.count({ where }),
    ]);

    // POST-PROCESSING: Add calculated fields
    const enrichedVendors = vendors.map((vendor) => {
      // Calculate if vendor is currently open
      const isOpen = calculateIsOpen(
        vendor.openingTime || undefined,
        vendor.closingTime || undefined,
      );

      // Calculate delivery time (prep time + delivery estimate)
      const deliveryTime = calculateDeliveryTime(
        vendor.avrgPreparationTime || undefined,
        lat ? parseFloat(String(lat)) : undefined,
        lng ? parseFloat(String(lng)) : undefined,
        vendor.address,
      );
      console.debug("Delivery time:", deliveryTime);

      // Calculate delivery fee (NEEDS NEW LOGIC - see below)
      const deliveryFee = calculateDeliveryFee(
        vendor,
        lat ? parseFloat(String(lat)) : undefined,
        lng ? parseFloat(String(lng)) : undefined,
      );

      // Calculate distance if user location provided
      const distance =
        lat &&
        lng &&
        vendor.address?.coordinates?.lat &&
        vendor.address?.coordinates?.long
          ? calculateDistance(
              parseFloat(String(lat)),
              parseFloat(String(lng)),
              vendor.address.coordinates.lat,
              vendor.address.coordinates.long,
            )
          : undefined;

      return {
        id: vendor.id,
        businessName: vendor.businessName,
        logoUrl: vendor.logoUrl,
        cuisine: vendor.categories, // Map to cuisine array
        rating: vendor.rating || 0,
        reviewCount: vendor.reviews?.length || 0,
        deliveryTime, // "25-35 min"
        deliveryFee, // 0 for free, number for paid
        isOpen,
        distance, // in km
        address: vendor.address,
        avrgPreparationTime: vendor.avrgPreparationTime,
        // Don't expose internal fields
      };
    });

    // FILTER BY OPEN (now that we calculated it)
    let filteredVendors = enrichedVendors;
    if (open === "true") {
      filteredVendors = enrichedVendors.filter((v) => v.isOpen);
    }

    // FILTER BY FREE DELIVERY
    if (freeDelivery === "true") {
      filteredVendors = filteredVendors.filter((v) => v.deliveryFee === 0);
    }

    // FILTER BY FAST DELIVERY (under 30 min)
    if (fastDelivery === "true") {
      filteredVendors = filteredVendors.filter((v) => {
        const maxTime = parseInt(v.deliveryTime.split("-")[1] || "99");
        return maxTime <= 30;
      });
    }

    // SORT BY DISTANCE (if applicable)
    if (sort === "distance" && lat && lng) {
      filteredVendors.sort((a, b) => (a.distance || 999) - (b.distance || 999));
    }

    return sendSuccess(res, {
      vendors: filteredVendors,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: filteredVendors.length, // Adjusted total after filtering
        pages: Math.ceil(filteredVendors.length / limitNum),
      },
    });
  } catch (err) {
    return handleError(res, err);
  }
};

//Update Vendor Profile
// PUT api/v1/vendors/me
export const updateVendorProfile = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor']
   * #swagger.summary = "Update current vendor's profile"
   * #swagger.description = 'Updates the profile of the currently authenticated vendor.'
   * #swagger.parameters['body'] = { in: 'body', description: 'Vendor profile data to update', required: true, schema: { type: 'object', properties: { businessName: { type: 'string' }, phoneNumber: { type: 'string' }, address: { type: 'object' }, logoUrl: { type: 'string' } } } }
   */
  const vendorId = req.user?.sub;
  if (!vendorId) throw new AppError(401, "Authentication required");

  const allowedFields = ["businessName", "phoneNumber", "address", "logoUrl"];

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

  if (
    (data.businessName && typeof data.businessName !== "string") ||
    (data.businessName && data.businessName.trim() === "")
  ) {
    errors.push("Business name must be a non-empty string");
  }

  if (data.phoneNumber && !isValidNigerianPhone(data.phoneNumber)) {
    errors.push("Invalid phone number format");
  }

  /*
  // types
type Address {
  street     String?
  city       String?
  state      String?
  lga        String?
  postalCode String?
  country    String? @default("Nigeria")
}
  */

  if (
    data.address &&
    !addressSchema.safeParse(data.address).success &&
    typeof data.address !== "string"
  ) {
    errors.push("Invalid address format");
  }

  if (data.logoUrl && typeof data.logoUrl !== "string") {
    errors.push("Logo URL must be a string");
  }

  if (errors.length > 0) {
    throw new AppError(400, errors.join(", "));
  }

  const updatedVendor = await prisma.vendor.update({
    where: { id: vendorId },
    data,
  });

  // Invalidate vendor cache
  await cacheService.invalidate(cacheService.generateKey("vendors", vendorId));
  await cacheService.invalidate(
    cacheService.generateKey("vendors", `profile_${vendorId}`),
  );
  await cacheService.invalidatePattern("vendors");

  return sendSuccess(res, {
    message: "Vendor updated successfully",
    vendor: updatedVendor,
  });
};

// Get Vendor's Products with Pagination
// GET /api/vendors/products/?page=&limit=
export const getVendorProducts = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor']
   * #swagger.summary = "Get vendor's products with pagination"
   * #swagger.description = 'Fetches a paginated list of products for the currently authenticated vendor.'
   * #swagger.parameters['page'] = { in: 'query', description: 'Page number', type: 'integer' }
   * #swagger.parameters['limit'] = { in: 'query', description: 'Number of items per page', type: 'integer' }
   */
  try {
    const vendorId = req.user?.sub;
    if (!vendorId) {
      throw new AppError(401, "Authentication required");
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;

    const totalProducts = await prisma.product.count({
      where: { vendorId },
    });
    const totalPages = Math.ceil(totalProducts / limit);

    const products = await prisma.product.findMany({
      where: { vendorId },
      skip: offset,
      take: limit,
    });
    return sendSuccess(res, {
      products,
      pagination: {
        totalProducts,
        totalPages,
        currentPage: page,
        pageSize: limit,
      },
    });
  } catch (error) {
    handleError(res, error);
  }
};

//GET /vendors/orders/?page=&limit= - List vendor orders
export const getVendorOrders = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor', 'Vendor Orders']
   * #swagger.summary = "Get vendor's orders with pagination"
   * #swagger.description = 'Fetches a paginated list of orders for the currently authenticated vendor.'
   * #swagger.parameters['page'] = { in: 'query', description: 'Page number', type: 'integer' }
   * #swagger.parameters['limit'] = { in: 'query', description: 'Number of items per page', type: 'integer' }
   */
  try {
    const vendorId = req.user?.sub;
    if (!vendorId) {
      throw new AppError(401, "Authentication required");
    }
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;

    const totalOrders = await prisma.order.count({
      where: { vendorId },
    });
    const totalPages = Math.ceil(totalOrders / limit);

    const orders = await prisma.order.findMany({
      where: { vendorId },
      skip: offset,
      take: limit,
      orderBy: { createdAt: "desc" },
    });
    return sendSuccess(res, {
      orders,
      pagination: {
        totalOrders,
        totalPages,
        currentPage: page,
        pageSize: limit,
      },
    });
  } catch (error) {
    handleError(res, error);
  }
};

// GET /vendors/orders/:orderId - Get order details
export const getVendorOrderById = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor', 'Vendor Orders']
   * #swagger.summary = "Get a single order for the vendor"
   * #swagger.description = 'Fetches details of a specific order belonging to the currently authenticated vendor.'
   * #swagger.parameters['orderId'] = { in: 'path', description: 'Order ID', required: true, type: 'string' }
   */
  try {
    const vendorId = req.user?.sub;
    const { orderId } = req.params;
    if (!vendorId) {
      throw new AppError(401, "Authentication required");
    }
    if (!isValidObjectId(orderId)) {
      throw new AppError(400, "Invalid order ID");
    }

    const order = await prisma.order.findFirst({
      where: { id: orderId, vendorId },
      include: {
        items: {
          include: {
            product: {
              include: {
                vendor: { select: { id: true, businessName: true } },
              },
            },
          },
        },
      },
    });
    if (!order) {
      throw new AppError(404, "Order not found");
    }

    return sendSuccess(res, { order });
  } catch (error) {
    handleError(res, error);
  }
};

export const updateOrderStatus = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor', 'Vendor Orders']
   * #swagger.summary = 'Update order status'
   * #swagger.description = 'Updates the status of an order. Vendors can only set status to ACCEPTED, PREPARING, READY_FOR_PICKUP, or CANCELLED.'
   * #swagger.security = [{ "bearerAuth": [] }]
   * #swagger.parameters['orderId'] = { in: 'path', description: 'Order ID', required: true, type: 'string' }
   * #swagger.parameters['body'] = { in: 'body', description: 'Status update data', required: true, schema: { type: 'object', properties: { status: { type: 'string', enum: ['ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'CANCELLED'] }, note: { type: 'string' } } } }
   */
  try {
    const actor = getActorFromReq(req);
    const { orderId } = req.params;
    const { status, note } = req.body;

    if (!actor) throw new AppError(401, "Unauthorized");
    if (actor.role !== "vendor")
      throw new AppError(403, "Only vendors can update order status");
    if (!orderId) throw new AppError(400, "Order ID is required");
    if (!status) throw new AppError(400, "Status is required");

    // Allowed statuses for vendors
    const allowedStatuses = [
      "ACCEPTED",
      "PREPARING",
      "READY_FOR_PICKUP",
      "CANCELLED",
    ];
    if (!allowedStatuses.includes(status)) {
      throw new AppError(
        400,
        `Vendors can only set status to: ${allowedStatuses.join(", ")}`,
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      // Verify order belongs to vendor
      const order = await tx.order.findFirst({
        where: { id: orderId, vendorId: actor.id },
        include: {
          customer: {
            select: { id: true, fullName: true, email: true },
          },
          vendor: {
            select: { id: true, businessName: true },
          },
          rider: {
            select: { id: true, fullName: true },
          },
        },
      });

      if (!order) throw new AppError(404, "Order not found or access denied");

      // Validate status transitions
      if (status === "ACCEPTED" && order.status !== "PENDING") {
        throw new AppError(400, "Can only accept orders with PENDING status");
      }

      if (status === "PREPARING" && order.status !== "ACCEPTED") {
        throw new AppError(400, "Can only prepare ACCEPTED orders");
      }

      if (status === "READY_FOR_PICKUP" && order.status !== "PREPARING") {
        throw new AppError(400, "Can only mark PREPARING orders as ready");
      }

      if (
        status === "CANCELLED" &&
        !["PENDING", "ACCEPTED"].includes(order.status)
      ) {
        throw new AppError(400, "Can only cancel PENDING or ACCEPTED orders");
      }

      // Update order
      const updated = await tx.order.update({
        where: { id: orderId },
        data: { status },
        include: {
          items: {
            include: {
              product: true,
              variant: true,
            },
          },
          customer: {
            select: { id: true, fullName: true, email: true },
          },
          vendor: {
            select: { id: true, businessName: true },
          },
          rider: {
            select: { id: true, fullName: true },
          },
        },
      });

      // Record history
      await tx.orderHistory.create({
        data: {
          orderId,
          status,
          actorId: actor.id,
          actorType: "VENDOR",
          note:
            note ??
            `Order status updated to ${status} by ${order.vendor.businessName}`,
        },
      });

      return updated;
    });

    // Emit socket notifications
    const notificationRecipients = [
      result.customerId,
      result.vendorId,
      result.riderId,
    ].filter(Boolean) as string[];

    const notificationMap: Record<
      string,
      { title: string; message: string; event: AppSocketEvent }
    > = {
      ACCEPTED: {
        title: `Order Accepted: ${result.id}`,
        message: `${result.vendor.businessName} has accepted your order`,
        event: AppSocketEvent.NOTIFICATION,
      },
      PREPARING: {
        title: `Order Preparing: ${result.id}`,
        message: `${result.vendor.businessName} is preparing your order`,
        event: AppSocketEvent.NOTIFICATION,
      },
      READY_FOR_PICKUP: {
        title: `Order Ready: ${result.id}`,
        message: `Order is ready for pickup from ${result.vendor.businessName}`,
        event: AppSocketEvent.NOTIFICATION,
      },
      CANCELLED: {
        title: `Order Cancelled: ${result.id}`,
        message: `${result.vendor.businessName} cancelled order: ${result.id}`,
        event: AppSocketEvent.NOTIFICATION,
      },
    };

    const notification = notificationMap[status as string];
    if (notification) {
      socketService.notifyTo(notificationRecipients, notification.event, {
        title: notification.title,
        type: status,
        message: notification.message,
        priority: "high",
        metadata: {
          orderId: result.id,
          vendorId: result.vendorId,
          actionUrl: `/orders/${result.id}`,
        },
        timestamp: result.updatedAt.toISOString(),
      });
    }

    // Invalidate order and vendor caches
    await cacheService.invalidatePattern("orders");
    await cacheService.invalidatePattern("userOrders");
    await cacheService.invalidatePattern("vendors");

    return sendSuccess(res, {
      message: notification.message,
      order: result,
    });
  } catch (error) {
    handleError(res, error);
  }
};

// Post /vendors/orders/:orderId/confirm-rider
export const confirmOrderRider = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor', 'Vendor Order']
   * #swagger.summary = 'Confirm if the Rider is Legit'
   * #swagger.description = Confirms the  order rider by verifying code.'
   * #swagger.parameters['id'] = { in: 'path', description: 'Product ID', required: true, type: 'string' }
   * #swagger.parameters['body'] = { in: 'body', description: 'Product variant data to create', required: true}
   */

  try {
    const vendorId = req.user?.sub;
    const { orderId } = req.params;
    const { code } = req.body;

    if (!vendorId) throw new AppError(401, "Unauthorized");
    if (!orderId) throw new AppError(400, "Order ID is required");
    if (!code || code.length !== 6)
      throw new AppError(
        400,
        "6 digit Code is required Kindly Ask the rider for their code",
      );

    // Verify order belongs to vendor
    const order = await prisma.order.findFirst({
      where: { id: orderId, vendorId },
    });

    if (!order) throw new AppError(404, "Order not found");
    if (!order.riderId) throw new AppError(404, "No Assigned Rider Yet");

    const response = await verifyOCCode(
      order.riderId,
      order.vendorId,
      order.id,
      code,
    );
    if (response.ok === (false as const))
      throw new AppError(
        500,
        `Failed to verify the rider's code: ${response.reason}`,
      );

    return sendSuccess(res, { ...response });
  } catch (error) {
    handleError(res, error);
  }
};

// Get Vendor Reviews with Pagination & Aggregation
// GET /api/vendors/:id/reviews
export const getVendorReviews = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor']
   * #swagger.summary = 'Get reviews, average rating, and distribution for a specific vendor'
   * #swagger.description = 'Fetches paginated reviews and aggregate statistics for a vendor.'
   * #swagger.parameters['id'] = { in: 'path', description: 'Vendor ID', required: true, type: 'string' }
   * #swagger.parameters['page'] = { in: 'query', description: 'Page number', type: 'integer' }
   * #swagger.parameters['limit'] = { in: 'query', description: 'Number of items per page', type: 'integer' }
   */
  try {
    const { id: vendorId } = req.params;

    if (!isValidObjectId(vendorId)) {
      throw new AppError(400, "Invalid vendor ID");
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;

    // Check cache first
    const key = cacheService.generateKey(
      "vendorReviews",
      `${vendorId}_${page}_${limit}`,
    );
    const cacheHit = await cacheService.get<any>(key);

    if (cacheHit) {
      console.debug(
        "--------------------------------Cache----------------------------",
      );
      return sendSuccess(res, cacheHit);
    }

    console.debug(
      "--------------------------------Missed----------------------------",
    );

    // 1. Check if Vendor exists
    const vendorExists = await prisma.vendor.findUnique({
      where: { id: vendorId },
      select: { id: true },
    });
    if (!vendorExists) {
      throw new AppError(404, "Vendor not found");
    }

    // Use Prisma.$transaction for efficiency
    const [reviews, totalReviews, averageResult, distributionResult] =
      await prisma.$transaction([
        // 2. Paginated Reviews Fetch
        prisma.review.findMany({
          where: { vendorId },
          skip: offset,
          take: limit,
          orderBy: { createdAt: "desc" },
          include: {
            user: {
              select: { fullName: true, profileImageUrl: true, id: true },
            },
          },
        }),

        // 3. Total Count
        prisma.review.count({ where: { vendorId } }),

        // 4. Average Rating Calculation
        prisma.review.aggregate({
          where: { vendorId },
          _avg: { rating: true },
        }),

        // 5. Rating Distribution (Group By)
        prisma.review.groupBy({
          by: ["rating"],
          where: { vendorId },
          _count: { rating: true },
          // REQUIRED FIX: Add orderBy to satisfy TypeScript/Prisma
          orderBy: {
            rating: "desc",
          },
        }),
      ]);

    // --- Data Processing and Transformation ---

    const avgRating = averageResult._avg.rating ?? 0;

    type Count =
      | {
          id?: number | undefined;
          rating?: number | undefined;
          comment?: number | undefined;
          createdAt?: number | undefined;
          updatedAt?: number | undefined;
          userId?: number | undefined;
          productId?: number | undefined;
          vendorId?: number | undefined;
          riderId?: number | undefined;
          _all?: number | undefined;
        }
      | undefined;

    // Map distribution to a usable format
    const ratingDistribution = [5, 4, 3, 2, 1].map((star) => {
      const group = distributionResult.find((r) => r.rating === star);
      const count = (group?._count as Count)?.rating! || 0;
      const percentage = totalReviews > 0 ? (count / totalReviews) * 100 : 0;

      return {
        stars: star,
        count: count,
        percentage: parseFloat(percentage.toFixed(2)),
      };
    });

    // Map fetched reviews to the desired Review interface
    const formattedReviews = reviews.map((review) => ({
      id: review.id,
      userId: review.userId,
      userName: review.user.fullName,
      userAvatar: review.user.profileImageUrl || undefined,
      rating: review.rating,
      comment: review.comment || "",
      createdAt: review.createdAt.toISOString(), // Standard date format
      // NOTE: likes/dislikes require separate models/queries, assuming 0 for now
      likes: 0,
      dislikes: 0,
    }));

    // --- Final Response Structure ---
    const reviewsData = {
      reviews: formattedReviews,
      averageRating: parseFloat(avgRating.toFixed(2)),
      totalReviews: totalReviews,
      ratingDistribution: ratingDistribution,
    };

    const data = { reviewsData };
    console.debug(
      "--------------------------------Adding to Cache----------------------------",
    );
    await cacheService.set(key, data);

    return sendSuccess(res, data);
  } catch (error) {
    handleError(res, error);
  }
};

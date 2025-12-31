import prisma from "@config/db";
import socketService from "@lib/socketService";
import { AppError, handleError, sendSuccess } from "@lib/utils/AppError";
import {
  isValidNigerianPhone,
  updateEntityPassword,
} from "@modules/auth/helper";
import { isValidObjectId } from "@modules/product/helpers";
import { Request, Response } from "express";
import {
  coerceNumber,
  createProductSchema,
  generateChartData,
  updateProductSchema,
} from "./helpers";
import { addressSchema } from "@lib/utils/address";
import { verifyOCCode } from "@config/redis";
import { hashPassword, verifyPassword } from "@lib/hash";

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

    return sendSuccess(res, { vendor });
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

    return sendSuccess(res, { vendor });
  } catch (error) {
    handleError(res, error);
  }
};

// GET /api/v1/vendors/profile
export const getVendorProfile = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor', 'Account']
   * #swagger.summary = 'Get vendor profile for account settings'
   * #swagger.description = 'Fetches complete vendor profile including business details'
   */
  try {
    const vendorId = req.user?.sub;
    if (!vendorId) {
      throw new AppError(401, "Authentication required");
    }

    const vendor = await prisma.vendor.findUnique({
      where: { id: vendorId },
      select: {
        id: true,
        email: true,
        businessName: true,
        phoneNumber: true,
        logoUrl: true,
        address: true,
        openingTime: true,
        closingTime: true,
        avrgPreparationTime: true,
        rating: true,
        isActive: true,
        isVerified: true,
        createdAt: true,
      },
    });

    if (!vendor) {
      throw new AppError(404, "Vendor not found");
    }

    return sendSuccess(res, { vendor });
  } catch (error) {
    handleError(res, error);
  }
};

// PUT /api/v1/vendors/profile
export const updateVendorProfileSettings = async (
  req: Request,
  res: Response,
) => {
  /**
   * #swagger.tags = ['Vendor', 'Account']
   * #swagger.summary = 'Update vendor profile settings'
   * #swagger.description = 'Updates business name, phone, address, hours, and logo'
   */
  try {
    const vendorId = req.user?.sub;
    if (!vendorId) {
      throw new AppError(401, "Authentication required");
    }

    const {
      businessName,
      phoneNumber,
      address,
      logoUrl,
      openingTime,
      closingTime,
      avrgPreparationTime,
    } = req.body;

    const updateData: any = {};
    const errors: string[] = [];

    // Validate and add fields
    if (businessName !== undefined) {
      if (typeof businessName !== "string" || businessName.trim() === "") {
        errors.push("Business name must be a non-empty string");
      } else {
        updateData.businessName = businessName.trim();
      }
    }

    if (phoneNumber !== undefined) {
      if (!isValidNigerianPhone(phoneNumber)) {
        errors.push("Invalid phone number format");
      } else {
        updateData.phoneNumber = phoneNumber;
      }
    }

    if (address !== undefined) {
      const validation = addressSchema.safeParse(address);
      if (!validation.success) {
        errors.push("Invalid address format");
      } else {
        updateData.address = address;
      }
    }

    if (logoUrl !== undefined) {
      if (typeof logoUrl !== "string") {
        errors.push("Logo URL must be a string");
      } else {
        updateData.logoUrl = logoUrl;
      }
    }

    if (openingTime !== undefined) {
      updateData.openingTime = openingTime;
    }

    if (closingTime !== undefined) {
      updateData.closingTime = closingTime;
    }

    if (avrgPreparationTime !== undefined) {
      updateData.avrgPreparationTime = avrgPreparationTime;
    }

    if (errors.length > 0) {
      throw new AppError(400, errors.join(", "));
    }

    if (Object.keys(updateData).length === 0) {
      throw new AppError(400, "No valid fields to update");
    }

    const updatedVendor = await prisma.vendor.update({
      where: { id: vendorId },
      data: updateData,
      select: {
        id: true,
        email: true,
        businessName: true,
        phoneNumber: true,
        logoUrl: true,
        address: true,
        openingTime: true,
        closingTime: true,
        avrgPreparationTime: true,
      },
    });

    return sendSuccess(res, {
      message: "Profile updated successfully",
      vendor: updatedVendor,
    });
  } catch (error) {
    handleError(res, error);
  }
};

// PUT /api/v1/vendors/change-password
export const changeVendorPassword = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor', 'Account']
   * #swagger.summary = 'Change vendor password'
   * #swagger.description = 'Allows vendor to update their password'
   */
  try {
    const vendorId = req.user?.sub;
    if (!vendorId) {
      throw new AppError(401, "Authentication required");
    }

    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      throw new AppError(400, "Current and new password are required");
    }

    if (newPassword.length < 8) {
      throw new AppError(400, "New password must be at least 8 characters");
    }

    // Get vendor with password hash
    const vendor = await prisma.vendor.findUnique({
      where: { id: vendorId },
      select: { id: true, passwordHash: true },
    });

    if (!vendor) {
      throw new AppError(404, "Vendor not found");
    }

    // Verify current password
    const isValidPassword = await verifyPassword(
      currentPassword,
      vendor.passwordHash,
    );

    if (!isValidPassword) {
      throw new AppError(401, "Current password is incorrect");
    }

    // Hash new password
    const newPasswordHash = await hashPassword(newPassword);

    await updateEntityPassword(vendorId, newPasswordHash, "vendor");

    return sendSuccess(res, {
      message: "Password changed successfully",
    });
  } catch (error) {
    handleError(res, error);
  }
};

// GET /api/v1/vendors/notifications/settings
export const getNotificationSettings = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor', 'Account']
   * #swagger.summary = 'Get notification preferences'
   * #swagger.description = 'Retrieves vendor notification settings'
   */
  try {
    const vendorId = req.user?.sub;
    if (!vendorId) {
      throw new AppError(401, "Authentication required");
    }

    // For now, return default settings since we don't have a NotificationSettings model
    // You can extend the Vendor model or create a new model later
    const settings = {
      orderNotifications: true,
      emailNotifications: true,
      pushNotifications: true,
      smsNotifications: false,
    };

    return sendSuccess(res, { settings });
  } catch (error) {
    handleError(res, error);
  }
};

// PUT /api/v1/vendors/notifications/settings
export const updateNotificationSettings = async (
  req: Request,
  res: Response,
) => {
  /**
   * #swagger.tags = ['Vendor', 'Account']
   * #swagger.summary = 'Update notification preferences'
   * #swagger.description = 'Updates vendor notification settings'
   */
  try {
    const vendorId = req.user?.sub;
    if (!vendorId) {
      throw new AppError(401, "Authentication required");
    }

    const {
      orderNotifications,
      emailNotifications,
      pushNotifications,
      smsNotifications,
    } = req.body;

    // For MVP, just validate and return success
    // Later, store this in a NotificationSettings table or Vendor model
    const settings = {
      orderNotifications: orderNotifications ?? true,
      emailNotifications: emailNotifications ?? true,
      pushNotifications: pushNotifications ?? true,
      smsNotifications: smsNotifications ?? false,
    };

    return sendSuccess(res, {
      message: "Notification settings updated successfully",
      settings,
    });
  } catch (error) {
    handleError(res, error);
  }
};

// GET /api/v1/vendors/stats
export const getVendorStats = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor', 'Account']
   * #swagger.summary = 'Get vendor statistics for account page'
   * #swagger.description = 'Returns basic stats like total orders, products, rating'
   */
  try {
    const vendorId = req.user?.sub;
    if (!vendorId) {
      throw new AppError(401, "Authentication required");
    }

    const [vendor, totalOrders, totalProducts, activeProducts] =
      await prisma.$transaction([
        prisma.vendor.findUnique({
          where: { id: vendorId },
          select: { rating: true, createdAt: true },
        }),
        prisma.order.count({ where: { vendorId } }),
        prisma.product.count({ where: { vendorId } }),
        prisma.product.count({
          where: { vendorId, isAvailable: true },
        }),
      ]);

    if (!vendor) {
      throw new AppError(404, "Vendor not found");
    }

    return sendSuccess(res, {
      stats: {
        rating: vendor.rating || 0,
        totalOrders,
        totalProducts,
        activeProducts,
        memberSince: vendor.createdAt,
      },
    });
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

    return sendSuccess(res, {
      vendors: vendors.map((v) => {
        return { ...v, isOpen: false };
      }),
      pagination: {
        totalVendors,
        totalPages,
        currentPage: page,
        pageSize: limit,
      },
    });
  } catch (error) {
    handleError(res, error);
  }
};

// Add this to your vendor controllers.ts file

// GET /api/vendors/dashboard
export const getVendorDashboard = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor']
   * #swagger.summary = 'Get vendor dashboard data'
   * #swagger.description = 'Fetches all dashboard data for the currently authenticated vendor including today\'s stats, active orders, and products count.'
   */
  try {
    const vendorId = req.user?.sub;
    if (!vendorId) {
      throw new AppError(401, "Authentication required");
    }

    // Get start and end of today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const [
      vendor,
      todayOrdersCount,
      todayEarnings,
      availableItemsCount,
      activeOrders,
    ] = await prisma.$transaction([
      // Get vendor details
      prisma.vendor.findUnique({
        where: { id: vendorId },
        select: {
          id: true,
          businessName: true,
          email: true,
          phoneNumber: true,
          logoUrl: true,
          rating: true,
          openingTime: true,
          closingTime: true,
          address: true,
        },
      }),

      // Count today's orders
      prisma.order.count({
        where: {
          vendorId,
          createdAt: {
            gte: todayStart,
            lte: todayEnd,
          },
        },
      }),

      // Calculate today's earnings (only from delivered or accepted orders)
      prisma.order.aggregate({
        where: {
          vendorId,
          createdAt: {
            gte: todayStart,
            lte: todayEnd,
          },
          status: {
            in: ["DELIVERED", "ACCEPTED", "PREPARING", "OUT_FOR_DELIVERY"],
          },
          paymentStatus: "SUCCESSFUL",
        },
        _sum: {
          totalAmount: true,
        },
      }),

      // Count available products
      prisma.product.count({
        where: {
          vendorId,
          isAvailable: true,
        },
      }),

      // Get active orders (not delivered or cancelled)
      prisma.order.findMany({
        where: {
          vendorId,
          status: {
            notIn: ["DELIVERED", "CANCELLED"],
          },
        },
        take: 6,
        orderBy: {
          createdAt: "desc",
        },
        include: {
          customer: {
            select: {
              id: true,
              fullName: true,
              profileImageUrl: true,
            },
          },
          items: {
            take: 1,
            include: {
              product: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      }),
    ]);

    if (!vendor) {
      throw new AppError(404, "Vendor not found");
    }

    return sendSuccess(res, {
      vendor,
      stats: {
        todayOrders: todayOrdersCount,
        todayEarnings: todayEarnings._sum.totalAmount || 0,
        availableItems: availableItemsCount,
      },
      activeOrders: activeOrders.map((order) => ({
        id: order.id,
        orderId: order.id.slice(-6).toUpperCase(),
        customerName: order.customer.fullName,
        customerAvatar: order.customer.profileImageUrl,
        status: order.status,
        totalAmount: order.totalAmount,
        itemCount: order.items.length,
        firstItemName: order.items[0]?.product.name || "N/A",
        createdAt: order.createdAt,
      })),
    });
  } catch (error) {
    handleError(res, error);
  }
};

// GET /api/vendors/earnings

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

  return sendSuccess(res, {
    message: "Vendor updated successfully",
    vendor: updatedVendor,
  });
};

// Get Vendor's Products with Pagination
// GET /api/vendors/products/?page=&limit=
export const getProducts = async (req: Request, res: Response) => {
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

// GET /api/v1/vendors/:id/products
// Get all products for a vendor
export const getVendorProducts = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor']
   * #swagger.summary = "Get vendor's products with pagination"
   * #swagger.parameters['id'] = { in: 'path', description: 'Product ID', required: true, type: 'string' }
   * #swagger.description = 'Fetches a paginated list of products for the currently authenticated vendor.'
   * #swagger.parameters['page'] = { in: 'query', description: 'Page number', type: 'integer' }
   * #swagger.parameters['limit'] = { in: 'query', description: 'Number of items per page', type: 'integer' }
   */
  try {
    // const userId = req.user?.sub;
    // if (!userId) {
    //   throw new AppError(401, "Authentication required");
    //   console.log("Authentication required");
    // }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;
    const vendorId = req.params.id;

    const totalProducts = await prisma.product.count({
      where: { vendorId },
    });
    const totalPages = Math.ceil(totalProducts / limit);

    const products = await prisma.product.findMany({
      where: { vendorId },
      include: {
        vendor: true,
      },
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

// POST /api/v1/products
export const createProduct = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor', 'Vendor Products']
   * #swagger.summary = 'Create a new product'
   * #swagger.description = 'Creates a new product for the authenticated vendor.'
   * #swagger.parameters['body'] = {in: 'body',description: 'Required product data, including name, description, and base price.',required: true,schema: {type: 'object',required: ['name', 'basePrice'],properties: {name: { type: 'string', minLength: 2, description: 'Product name (min 2 characters, required).', example: 'Doorite Food' },description: { type: 'string', description: 'Detailed product description.', example: 'Doorite Food' },basePrice: { type: 'number', minimum: 0.01, description: 'Base price of the product (required, positive number).', example: 5000 },sku: { type: 'string', description: 'Stock keeping unit.', example: '' },attributes: { type: 'object', description: 'A dictionary of custom product attributes.', example: {} },isAvailable: { type: 'boolean', default: true, description: 'Product availability status.', example: false },variants: {type: 'array',description: 'List of product variants.', example: {}}}}}
   */
  try {
    const vendorId = req.user?.sub;

    if (!vendorId) throw new AppError(401, "Authentication required");

    // const data = validateCreateProduct(req.body || {});
    const { error, data } = createProductSchema.safeParse(req.body);
    if (error) {
      throw new AppError(400, `Fail to Validate the input ${error.cause}`);
    }

    // verify vendor
    const vendor = await prisma.vendor.findUnique({
      where: { id: vendorId },
      select: { id: true, isActive: true, isVerified: true },
    });

    if (!vendor || !vendor.isActive || !vendor.isVerified)
      throw new AppError(403, "Vendor account not active or verified");

    const result = await prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          vendorId: vendorId,
          name: data.name,
          description: data.description,
          basePrice: data.basePrice,
          sku: data.sku,
          attributes: data.attributes || {},
          isAvailable: data.isAvailable !== false,
        },
      });

      let variants = [] as any[];
      if (data.variants && data.variants.length) {
        const vPromises = data.variants.map((v: any) =>
          tx.productVariant.create({
            data: {
              productId: product.id,
              name: v.name,
              price: v.price,
              // attributes: v.attributes || {},
              stock: v.stock ?? undefined,
              isAvailable: v.isAvailable !== false,
            },
          }),
        );
        variants = await Promise.all(vPromises);
      }

      return { product, variants };
    });

    // fetch full product for response
    const complete = await prisma.product.findUnique({
      where: { id: result.product.id },
      include: {
        variants: { orderBy: { createdAt: "asc" } },
        vendor: { select: { id: true, businessName: true } },
      },
    });

    return sendSuccess(
      res,
      { message: "Product created successfully", product: complete },
      201,
    );
  } catch (err) {
    return handleError(res, err);
  }
};

// PUT /api/v1/vendors/products/:id
export const updateProduct = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor', 'Vendor Products']
   * #swagger.summary = 'Update a product'
   * #swagger.description = 'Updates an existing product for the authenticated vendor.'
   * #swagger.parameters['id'] = { in: 'path', description: 'Product ID', required: true, type: 'string' }
   * #swagger.parameters['body'] = {in: 'body',description: 'Product fields to update. At least one field is required.',required: true,schema: {type: 'object',properties: {name: { type: 'string', minLength: 2, description: 'New product name (min 2 characters).' },description: { type: 'string', description: 'New detailed product description.' },basePrice: { type: 'number', minimum: 0.01, description: 'New base price (positive number).' },sku: { type: 'string', description: 'New stock keeping unit.' },attributes: { type: 'object', description: 'A dictionary of custom product attributes.' },isAvailable: { type: 'boolean', description: 'New product availability status.' }}}}
   */
  try {
    const vendorId = req.user?.sub;
    const { id: productId } = req.params;
    if (!isValidObjectId(productId))
      throw new AppError(400, "Product ID is required");

    const { data: updateData, error } = updateProductSchema.safeParse(
      req.body || {},
    );
    if (error)
      throw new AppError(400, `Error Validating the Inputs: ${error.cause}`);

    const existing = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, vendorId: true },
    });
    if (!existing) throw new AppError(404, "Product not found");
    if (existing.vendorId !== vendorId)
      throw new AppError(
        403,
        "Unauthorized: Cannot modify another vendor's product",
      );

    const updated = await prisma.product.update({
      where: { id: productId },
      data: {
        ...updateData,
      },
      include: { variants: { orderBy: { createdAt: "asc" } } },
    });

    return sendSuccess(res, {
      message: "Product updated successfully",
      product: updated,
    });
  } catch (err) {
    return handleError(res, err);
  }
};

// GET /api/v1/vendors/earnings?period=daily|weekly|monthly
export const getVendorEarnings = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor', 'Vendor Earnings']
   * #swagger.summary = 'Get vendor earnings data'
   * #swagger.description = 'Fetches earnings data, transactions, and analytics for the vendor'
   * #swagger.parameters['period'] = { in: 'query', description: 'Time period (daily, weekly, monthly)', type: 'string', enum: ['daily', 'weekly', 'monthly'] }
   */
  try {
    const vendorId = req.user?.sub;
    if (!vendorId) {
      throw new AppError(401, "Authentication required");
    }

    const period = (req.query.period as string) || "weekly";
    if (!["daily", "weekly", "monthly"].includes(period)) {
      throw new AppError(400, "Invalid period. Use daily, weekly, or monthly");
    }

    const now = new Date();
    let startDate: Date;
    let groupByFormat: string;
    let chartPoints: number;

    // Determine date range based on period
    switch (period) {
      case "daily":
        startDate = new Date(now);
        startDate.setHours(0, 0, 0, 0);
        groupByFormat = "hour";
        chartPoints = 24;
        break;
      case "weekly":
        startDate = new Date(now);
        startDate.setDate(now.getDate() - 6);
        startDate.setHours(0, 0, 0, 0);
        groupByFormat = "day";
        chartPoints = 7;
        break;
      case "monthly":
        startDate = new Date(now);
        startDate.setDate(1);
        startDate.setHours(0, 0, 0, 0);
        groupByFormat = "week";
        chartPoints = 4;
        break;
      default:
        startDate = new Date(now);
        startDate.setDate(now.getDate() - 6);
        groupByFormat = "day";
        chartPoints = 7;
    }

    // Fetch wallet data
    const wallet = await prisma.wallet.findUnique({
      where: { vendorId },
      select: {
        balance: true,
        totalEarned: true,
        totalWithdrawn: true,
      },
    });

    // Fetch orders for the period
    const orders = await prisma.order.findMany({
      where: {
        vendorId,
        createdAt: { gte: startDate },
        paymentStatus: "SUCCESSFUL",
        status: {
          in: ["DELIVERED", "ACCEPTED", "PREPARING", "OUT_FOR_DELIVERY"],
        },
      },
      select: {
        id: true,
        totalAmount: true,
        createdAt: true,
        customer: {
          select: {
            id: true,
            fullName: true,
            profileImageUrl: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Calculate total earnings for period
    const totalEarnings = orders.reduce(
      (sum, order) => sum + order.totalAmount,
      0,
    );

    // Get previous period for comparison
    const previousStartDate = new Date(startDate);
    switch (period) {
      case "daily":
        previousStartDate.setDate(previousStartDate.getDate() - 1);
        break;
      case "weekly":
        previousStartDate.setDate(previousStartDate.getDate() - 7);
        break;
      case "monthly":
        previousStartDate.setMonth(previousStartDate.getMonth() - 1);
        break;
    }

    const previousOrders = await prisma.order.findMany({
      where: {
        vendorId,
        createdAt: {
          gte: previousStartDate,
          lt: startDate,
        },
        paymentStatus: "SUCCESSFUL",
        status: {
          in: ["DELIVERED", "ACCEPTED", "PREPARING", "OUT_FOR_DELIVERY"],
        },
      },
      select: { totalAmount: true },
    });

    const previousEarnings = previousOrders.reduce(
      (sum, order) => sum + order.totalAmount,
      0,
    );

    // Calculate percentage change
    const percentageChange =
      previousEarnings > 0
        ? ((totalEarnings - previousEarnings) / previousEarnings) * 100
        : totalEarnings > 0
          ? 100
          : 0;

    // Generate chart data
    const chartData = generateChartData(orders, period, startDate, chartPoints);

    // Format recent transactions (last 5)
    const recentTransactions = orders.slice(0, 5).map((order) => ({
      id: order.id,
      orderId: order.id.slice(-6).toUpperCase(),
      customerName: order.customer.fullName,
      customerAvatar: order.customer.profileImageUrl,
      amount: order.totalAmount,
      date: order.createdAt,
    }));

    // Calculate pending payout (orders delivered but not withdrawn)
    const deliveredOrders = await prisma.order.findMany({
      where: {
        vendorId,
        status: "DELIVERED",
        paymentStatus: "SUCCESSFUL",
        createdAt: { gte: startDate },
      },
      select: { totalAmount: true },
    });

    const pendingPayout = deliveredOrders.reduce(
      (sum, order) => sum + order.totalAmount,
      0,
    );

    return sendSuccess(res, {
      summary: {
        totalEarnings,
        percentageChange: parseFloat(percentageChange.toFixed(2)),
        period,
      },
      wallet: wallet || {
        balance: 0,
        totalEarned: 0,
        totalWithdrawn: 0,
      },
      chartData,
      recentTransactions,
      pendingPayout,
    });
  } catch (error) {
    handleError(res, error);
  }
};

// DELETE /api/v1/vendors/products/:id
export const deleteProduct = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor', 'Vendor Products']
   * #swagger.summary = 'Delete a product'
   * #swagger.description = 'Deletes a product for the authenticated vendor. Fails if the product has been ordered.'
   * #swagger.parameters['id'] = { in: 'path', description: 'Product ID', required: true, type: 'string' }
   */
  try {
    const vendorId = req.user?.sub;
    const { id: productId } = req.params;
    if (!isValidObjectId(productId))
      throw new AppError(400, "Product ID is required");

    const product = await prisma.product.findUnique({
      where: { id: productId },
      // select: { id: true, vendorId: true },
      include: { orderItems: { select: { id: true }, take: 1 } },
    });

    if (!product) throw new AppError(404, "Product not found");
    if (product.vendorId !== vendorId)
      throw new AppError(
        403,
        "Unauthorized: Cannot delete another vendor's product",
      );

    // if there are orderItems, refuse permanent deletion
    if (product.orderItems && product.orderItems.length > 0) {
      throw new AppError(
        400,
        "Cannot permanently delete product that has been ordered. Use prepare-delete instead.",
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.productVariant.deleteMany({ where: { productId } });
      await tx.product.delete({ where: { id: productId } });
    });

    return sendSuccess(res, { message: "Product permanently deleted" });
  } catch (err) {
    return handleError(res, err);
  }
};

// POST /api/v1/vendors/products/:id/variants
export const createProductVariant = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor', 'Vendor Products']
   * #swagger.summary = 'Create a product variant'
   * #swagger.description = 'Creates a new variant for a specific product.'
   * #swagger.parameters['id'] = { in: 'path', description: 'Product ID', required: true, type: 'string' }
   * #swagger.parameters['body'] = { in: 'body', description: 'Product variant data to create', required: true}
   */
  try {
    const vendorId = req.user?.sub;
    const { id: productId } = req.params;

    if (!isValidObjectId(productId))
      throw new AppError(400, "Product ID is required");

    const { name, price, attributes, stock, isAvailable } = req.body || {};

    if (attributes !== undefined && typeof attributes !== "object") {
      throw new AppError(400, "attributes must be a JSON object");
    }

    if (!name || typeof name !== "string" || name.trim().length === 0)
      throw new AppError(400, "Variant name is required");
    const priceNum = coerceNumber(price);
    if (priceNum === null || priceNum <= 0)
      throw new AppError(400, "Valid variant price is required");

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, vendorId: true },
    });
    if (!product) throw new AppError(404, "Product not found");
    if (product.vendorId !== vendorId)
      throw new AppError(
        403,
        "Unauthorized: Cannot modify another vendor's product",
      );

    const variant = await prisma.productVariant.create({
      data: {
        productId,
        name: name.trim(),
        price: priceNum,
        // attributes: attributes ?? {},
        stock: Number.isInteger(stock) ? stock : undefined,
        isAvailable: isAvailable === undefined ? true : Boolean(isAvailable),
      },
    });

    return sendSuccess(
      res,
      { message: "Product variant created successfully", variant },
      201,
    );
  } catch (err) {
    return handleError(res, err);
  }
};

// PUT /api/v1/vendors/products/:id/variants/:variantId
export const updateProductVariant = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor', 'Vendor Products']
   * #swagger.summary = 'Update a product variant'
   * #swagger.description = 'Updates a specific product variant.'
   * #swagger.parameters['id'] = { in: 'path', description: 'Product ID', required: true, type: 'string' }
   * #swagger.parameters['variantId'] = { in: 'path', description: 'Variant ID', required: true, type: 'string' }
   * #swagger.parameters['body'] = { in: 'body', description: 'Product variant data to update', required: true}
   */
  try {
    const vendorId = req.user?.sub;
    const { id: productId, variantId } = req.params;

    if (!isValidObjectId(productId) || !isValidObjectId(variantId))
      throw new AppError(400, "Product ID and Variant ID are required");

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, vendorId: true },
    });
    if (!product) throw new AppError(404, "Product not found");
    if (product.vendorId !== vendorId)
      throw new AppError(
        403,
        "Unauthorized: Cannot modify another vendor's product",
      );

    const existingVariant = await prisma.productVariant.findFirst({
      where: { id: variantId, productId },
    });
    if (!existingVariant) throw new AppError(404, "Product variant not found");

    const { name, price, attributes, stock, isAvailable } = req.body || {};
    const updateData: any = {};

    if (name !== undefined) {
      if (typeof name !== "string" || name.trim().length === 0)
        throw new AppError(400, "Valid variant name is required");
      updateData.name = name.trim();
    }

    if (price !== undefined) {
      const priceNum = coerceNumber(price);
      if (priceNum === null || priceNum <= 0)
        throw new AppError(400, "Valid variant price is required");
      updateData.price = priceNum;
    }

    if (attributes !== undefined) updateData.attributes = attributes;
    if (stock !== undefined) {
      if (!Number.isInteger(stock) || stock < 0)
        throw new AppError(400, "stock must be an integer >= 0");
      updateData.stock = stock;
    }
    if (isAvailable !== undefined)
      updateData.isAvailable = Boolean(isAvailable);

    const updated = await prisma.productVariant.update({
      where: { id: variantId },
      data: updateData,
    });

    return sendSuccess(res, {
      message: "Product variant updated successfully",
      variant: updated,
    });
  } catch (err) {
    return handleError(res, err);
  }
};

// DELETE /api/v1/vendors/products/:id/variants/:variantId
export const deleteProductVariant = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor', 'Vendor Products']
   * #swagger.summary = 'Delete a product variant'
   * #swagger.description = 'Deletes a specific product variant. Fails if the variant has been ordered.'
   * #swagger.parameters['id'] = { in: 'path', description: 'Product ID', required: true, type: 'string' }
   * #swagger.parameters['variantId'] = { in: 'path', description: 'Variant ID', required: true, type: 'string' }
   */
  try {
    const vendorId = req.user?.sub;
    const { id: productId, variantId } = req.params;

    if (!isValidObjectId(productId) || !isValidObjectId(variantId))
      throw new AppError(400, "Product ID and Variant ID are required");

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, vendorId: true },
    });
    if (!product) throw new AppError(404, "Product not found");
    if (product.vendorId !== vendorId)
      throw new AppError(
        403,
        "Unauthorized: Cannot modify another vendor's product",
      );

    const variant = await prisma.productVariant.findUnique({
      where: { id: variantId },
      include: { orderItems: { select: { id: true }, take: 1 } },
    });
    if (!variant || variant.productId !== productId)
      throw new AppError(404, "Product variant not found");

    if (variant.orderItems && variant.orderItems.length > 0)
      throw new AppError(400, "Cannot delete variant that has been ordered");

    await prisma.productVariant.delete({ where: { id: variantId } });

    return sendSuccess(res, {
      message: "Product variant deleted successfully",
    });
  } catch (err) {
    return handleError(res, err);
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

// PATCH /vendors/orders/:orderId/status
export const updateOrderStatus = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor', 'Vendor Orders']
   * #swagger.summary = 'Update order status'
   * #swagger.description = 'Updates the status of an order. Vendors can only set status to ACCEPTED, PREPARING, or CANCELLED.'
   * #swagger.security = [{ "bearerAuth": [] }]
   * #swagger.parameters['orderId'] = { in: 'path', description: 'Order ID', required: true, type: 'string' }
   * #swagger.parameters['body'] = { in: 'body', description: 'Status update data', required: true, schema: { type: 'object', properties: { status: { type: 'string', enum: ['ACCEPTED', 'PREPARING', 'CANCELLED'] }, note: { type: 'string' } } } }
   */
  try {
    const vendorId = req.user?.sub;
    const { orderId } = req.params;
    const { status, note } = req.body;

    if (!vendorId) throw new AppError(401, "Unauthorized");
    if (!orderId) throw new AppError(400, "Order ID is required");
    if (!status) throw new AppError(400, "Status is required");

    // Verify order belongs to vendor
    const order = await prisma.order.findFirst({
      where: { id: orderId, vendorId },
    });

    if (!order) throw new AppError(404, "Order not found");

    // Vendor can only set these statuses
    const allowedStatuses = ["ACCEPTED", "PREPARING", "CANCELLED"];
    if (!allowedStatuses.includes(status)) {
      throw new AppError(
        400,
        `Vendors can only set status to: ${allowedStatuses.join(", ")}`,
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.order.update({
        where: { id: orderId },
        data: { status },
        include: {
          items: true,
          customer: {
            select: { id: true, fullName: true, email: true },
          },
          rider: {
            select: { id: true, fullName: true },
          },
        },
      });

      await tx.orderHistory.create({
        data: {
          orderId,
          status,
          actorId: vendorId,
          actorType: "VENDOR",
          note: note ?? `Order status updated to ${status}`,
        },
      });

      return updated;
    });

    // Emit order update
    try {
      socketService.emitOrderUpdate(result);
    } catch (e: Error | any) {
      console.warn("Failed to emit order update:", e?.message || e);
    }

    return sendSuccess(res, {
      message: `Order status updated to ${status}`,
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

    return sendSuccess(res, { reviewsData });
  } catch (error) {
    handleError(res, error);
  }
};

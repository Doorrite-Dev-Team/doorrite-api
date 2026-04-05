import prisma from "@config/db";
import { hashPassword } from "@lib/hash";
import { addressSchema, deleteUserAdress } from "@lib/utils/address";
import { AppError, handleError, sendSuccess } from "@lib/utils/AppError";
import {
  handlePasswordReset,
  isValidEmail,
  isValidNigerianPhone,
  validatePassword,
} from "@modules/auth/helper";
import { Request, Response } from "express";
import { cacheService } from "@config/cache";
import { Pagination } from "types/types";
import { PendingReviewService } from "@services/redis/pending-review";
import { updateVendorRating, updateProductRating } from "@services/review-hooks";

// Get User by ID
// GET api/v1/users/:id
export const getUser = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['User']
   * #swagger.summary = 'Get user by ID'
   * #swagger.description = 'Retrieves a user by their ID.'
   * #swagger.parameters['id'] = { in: 'path', description: 'User ID', required: true, type: 'string' }
   */
  try {
    const { id } = req.params;

    const key = cacheService.generateKey("users", id);
    const cacheHit = await cacheService.get<{ user: any }>(key);

    if (cacheHit) {
      console.debug(
        "--------------------------------Cache----------------------------",
      );
      return sendSuccess(res, cacheHit, 200);
    }

    console.debug(
      "--------------------------------Missed----------------------------",
    );

    const user = await prisma.user.findUnique({
      where: { id },
    });

    if (!user) throw new AppError(404, "User not found");

    const data = { user };
    console.debug(
      "--------------------------------Adding to Cache----------------------------",
    );
    await cacheService.set(key, data);

    return sendSuccess(res, data, 200);
  } catch (err) {
    return handleError(res, err);
  }
};

// Get All Users with pagination
// GET api/v1/users/?page=&limit=
export const getAllUsers = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['User']
   * #swagger.summary = 'Get all users'
   *
   */
  try {
    const { page = "1", limit = "20" } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page));
    const lim = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * lim;
    const [users, total] = await Promise.all([
      prisma.user.findMany({
        take: lim,
        skip,
        orderBy: { createdAt: "desc" },
        include: {
          reviews: true,
        },
      }),
      prisma.user.count(),
    ]);
    return sendSuccess(res, {
      users,
      pagination: { total, page: pageNum, limit: lim },
    });
  } catch (error) {
    handleError(res, error);
  }
};

// Get Current User Profile
// GET api/v1/users/me
export const getCurrentUserProfile = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['User']
   * #swagger.summary = 'Get current user profile'
   * #swagger.description = 'Retrieves profile of currently authenticated user.'
   * #swagger.security = [{ "bearerAuth": [] }]
   */
  try {
    const userId = req.user?.sub;
    if (!userId) throw new AppError(401, "Unauthorized");

    const key = cacheService.generateKey("users", `profile_${userId}`);
    const cacheHit = await cacheService.get<{ user: any }>(key);

    if (cacheHit) {
      console.debug(
        "--------------------------------Cache----------------------------",
      );
      return sendSuccess(res, cacheHit, 200);
    }

    console.debug(
      "--------------------------------Missed----------------------------",
    );

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) throw new AppError(404, "User not found");

    const data = { user };
    console.debug(
      "--------------------------------Adding to Cache----------------------------",
    );
    await cacheService.set(key, data);

    return sendSuccess(res, data, 200);
  } catch (error) {
    handleError(res, error);
  }
};

// Update User Profile
// PUT api/v1/users/me
export const updateUserProfile = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['User']
   * #swagger.summary = 'Update user profile'
   * #swagger.description = 'Updates the profile of the currently authenticated user.'
   * #swagger.security = [{ "bearerAuth": [] }]
   * #swagger.parameters['body'] = { in: 'body', description: 'User profile data', required: true, schema: { type: 'object', properties: { fullName: { type: 'string' }, phoneNumber: { type: 'string' }, profileImageUrl: { type: 'string' }, address: { type: 'object' } } } }
   */
  const id = req.user?.sub;
  if (!id) {
    return handleError(res, new AppError(400, "User ID is required"));
  }

  // ✅ Define allowed fields (mutable)
  const allowedFields = [
    "fullName",
    "phoneNumber",
    "profileImageUrl",
    "address",
  ];

  // Pick only allowed fields from req.body
  const data: Record<string, any> = {};
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      data[field] = req.body[field];
    }
  }

  // If no allowed field provided
  if (Object.keys(data).length === 0) {
    return handleError(
      res,
      new AppError(400, "No valid update fields provided"),
    );
  }

  // Extra validation example

  // ✅ Collect validation errors instead of failing one by one
  const errors: string[] = [];

  if (data.fullName && data.fullName.trim().length === 0) {
    errors.push("Full name cannot be empty");
  }

  if (data.address && !addressSchema.safeParse(data.address).success) {
    errors.push("Invalid address format");
  }

  if (data.profileImageUrl && typeof data.profileImageUrl !== "string") {
    errors.push("Profile image URL must be a string");
  }

  if (data.phoneNumber && !isValidNigerianPhone(data.phoneNumber)) {
    errors.push("Invalid phone number format");
  }

  if (errors.length > 0) {
    return handleError(res, new AppError(400, errors.join(", ")));
  }

  try {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw new AppError(404, "User not found");

    if (user.id !== req.user?.sub) throw new AppError(403, "Unauthorized");

    const updateData: any = { ...data };
    if (data.address) {
      delete updateData.address;
      updateData.address = { push: data.address };
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: updateData,
    });

    // Invalidate user cache
    await cacheService.invalidate(cacheService.generateKey("users", id));
    await cacheService.invalidate(
      cacheService.generateKey("users", `profile_${id}`),
    );

    return sendSuccess(res, {
      message: "User updated successfully",
      user: updatedUser,
    });
  } catch (err) {
    return handleError(res, err);
  }
};

// Get User Orders with pagination
//response : {  "data": [...],  "pagination": {    "totalItems": 95,    "totalPages": 10,    "currentPage": 3,    "limit": 20,    "hasNext": true,    "hasPrev": true  }}
// GET /users/orders/
export const getUserOrders = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['User', 'User Orders']
   * #swagger.summary = 'Get user orders'
   * #swagger.description = 'Retrieves a paginated list of orders for the currently authenticated user.'
   * #swagger.security = [{ "bearerAuth": [] }]
   * #swagger.parameters['page'] = { in: 'query', description: 'Page number', type: 'integer' }
   * #swagger.parameters['limit'] = { in: 'query', description: 'Page size', type: 'integer' }
   * #swagger.parameters['sort'] = { in: 'query', description: 'Sort order (asc/desc)', type: 'string' }
   * #swagger.parameters['status'] = { in: 'query', description: 'Filter by status', type: 'string' }
   */
  try {
    const userId = req.user?.sub;
    if (!userId) throw new AppError(401, "Unauthorized");
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const sort = (req.query.sort as string) === "asc" ? "asc" : "desc";
    const status = req.query.status as string;
    const skip = (page - 1) * limit;

    const whereClause: any = { customerId: userId };
    if (status && status !== "all") {
      whereClause.status = status.toUpperCase();
    }

    const key = cacheService.generateKey(
      "userOrders",
      `${userId}_${page}_${limit}_${sort}_${status || "all"}`,
    );
    const cacheHit =
      await cacheService.get<Pagination<{ orders: any[]; pagination: any }>>(
        key,
      );

    if (cacheHit) {
      console.debug(
        "--------------------------------Cache----------------------------",
      );
      return sendSuccess(res, cacheHit, 200);
    }

    console.debug(
      "--------------------------------Missed----------------------------",
    );

    const [totalItems, orders] = await Promise.all([
      prisma.order.count({ where: whereClause }),
      prisma.order.findMany({
        where: whereClause,
        include: {
          items: {
            include: { product: true },
          },
        },
        skip,
        take: limit,
        orderBy: { createdAt: sort },
      }),
    ]);
    const totalPages = Math.ceil(totalItems / limit);

    const pagination = {
      totalItems,
      totalPages,
      currentPage: page,
      limit,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    };

    const data = { orders, pagination };
    console.debug(
      "--------------------------------Adding to Cache----------------------------",
    );
    await cacheService.set(key, data);

    return sendSuccess(res, data, 200);
  } catch (error) {
    handleError(res, error);
  }
};

// Create User Review for vendor, rider or product
// POST /users/reviews
export const createUserReview = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['User', 'User Reviews']
   * #swagger.summary = 'Create a review'
   * #swagger.description = 'Creates a review for a vendor, rider, or product.'
   * #swagger.security = [{ "bearerAuth": [] }]
   * #swagger.parameters['body'] = { in: 'body', description: 'Review data', required: true, schema: { type: 'object', properties: { orderId: { type: 'string' }, vendorRating: { type: 'integer', minimum: 1, maximum: 5 }, riderRating: { type: 'integer', minimum: 1, maximum: 5 }, comment: { type: 'string' }, productRatings: { type: 'array', items: { type: 'object', properties: { productId: { type: 'string' }, rating: { type: 'integer' } } } } } } }
   */
  try {
    const userId = req.user?.sub;
    if (!userId) throw new AppError(401, "Unauthorized");

    const { orderId, vendorRating, riderRating, comment, productRatings } = req.body;

    if (!orderId) {
      throw new AppError(400, "orderId is required");
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { product: true } } },
    });

    if (!order) {
      throw new AppError(404, "Order not found");
    }

    if (order.customerId !== userId) {
      throw new AppError(403, "Not authorized to review this order");
    }

    if (order.status !== "DELIVERED") {
      throw new AppError(400, "Can only review delivered orders");
    }

    const existingReview = await prisma.review.findUnique({
      where: { orderId },
    });

    if (existingReview) {
      throw new AppError(400, "Order already reviewed");
    }

    const review = await prisma.review.create({
      data: {
        userId,
        orderId,
        rating: vendorRating || riderRating || 5,
        comment,
        vendorId: order.vendorId,
        riderId: order.riderId || undefined,
        productReviews: productRatings
          ? {
              create: productRatings.map((pr: any) => ({
                productId: pr.productId,
                rating: pr.rating,
              })),
            }
          : undefined,
      },
    });

    await updateVendorRating(order.vendorId);

    if (productRatings) {
      for (const pr of productRatings) {
        await updateProductRating(pr.productId);
      }
    }

    await PendingReviewService.remove(userId, orderId);

    await cacheService.invalidatePattern("vendorReviews");

    return sendSuccess(res, { review }, 201);
  } catch (error) {
    handleError(res, error);
  }
};

/*
try {
    const userId = req.user?.sub;
    if (!userId) throw new AppError(401, "Unauthorized");
    const { productId, rating, comment } = req.body;
    if (!productId || !rating) {
      throw new AppError(400, "Product ID and rating are required");
    }

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new AppError(404, "Product not found");

    const review = await prisma.review.create({
      data: {
        userId,
        productId,
        rating,
        comment,
      },
    });

    return sendSuccess(res, { review }, 201);
  } catch (error) {
    handleError(res, error);
  }

*/

// Delete User Address
// DELETE api/v1/users/address
export const deleteAddress = async (req: Request, res: Response) => {
  try {
    const id = req.user?.sub;
    if (!id) throw new AppError(401, "Unauthorized");
    const { addressToDelete } = req.body;
    if (!addressToDelete) {
      throw new AppError(400, "Kindly Provide valid Address");
    }

    await deleteUserAdress(id, addressToDelete);

    return sendSuccess(res, {
      message: "Address deleted successfully",
      ok: true,
    });
  } catch (error) {
    handleError(res, error);
  }
};

// Get User Addresses
// GET /users/addresses
export const getUserAddresses = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.sub;
    if (!userId) throw new AppError(401, "Unauthorized");

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { address: true },
    });

    return sendSuccess(res, { addresses: user?.address || [] });
  } catch (error) {
    handleError(res, error);
  }
};

// Create New Address
// POST /users/addresses
export const createAddress = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.sub;
    if (!userId) throw new AppError(401, "Unauthorized");

    const { address, state, country, coordinates } = req.body;

    if (!address) throw new AppError(400, "Address is required");

    const newAddress = {
      address: String(address),
      state: state || "Ilorin",
      country: country || "Nigeria",
      coordinates: coordinates || { lat: 0, long: 0 },
    };

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { address: true },
    });

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        address: {
          push: newAddress,
        },
      },
    });

    const createdAddress = updatedUser.address[updatedUser.address.length - 1];

    await cacheService.invalidate(cacheService.generateKey("users", userId));
    await cacheService.invalidate(cacheService.generateKey("users", `profile_${userId}`));

    return sendSuccess(res, { address: createdAddress }, 201);
  } catch (error) {
    handleError(res, error);
  }
};

// Update Address
// PUT /users/addresses/:id
export const updateAddress = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.sub;
    if (!userId) throw new AppError(401, "Unauthorized");

    const { id } = req.params;
    const { address, state, country, coordinates } = req.body;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { address: true },
    });

    if (!user || !user.address) {
      throw new AppError(404, "User or addresses not found");
    }

    const addressIndex = parseInt(id, 10);
    if (isNaN(addressIndex) || addressIndex < 0 || addressIndex >= user.address.length) {
      throw new AppError(404, "Address not found");
    }

    const updatedAddresses = [...user.address];
    updatedAddresses[addressIndex] = {
      ...updatedAddresses[addressIndex],
      ...(address && { address: String(address) }),
      ...(state && { state: String(state) }),
      ...(country && { country: String(country) }),
      ...(coordinates && { coordinates }),
    };

    await prisma.user.update({
      where: { id: userId },
      data: { address: updatedAddresses },
    });

    await cacheService.invalidate(cacheService.generateKey("users", userId));
    await cacheService.invalidate(cacheService.generateKey("users", `profile_${userId}`));

    return sendSuccess(res, { address: updatedAddresses[addressIndex] });
  } catch (error) {
    handleError(res, error);
  }
};

// Get User Favorites
// GET /users/favorites
export const getUserFavorites = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.sub;
    if (!userId) throw new AppError(401, "Unauthorized");

    const favorites = await prisma.favorite.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    const productIds = favorites.map(f => f.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      include: {
        vendor: {
          select: {
            id: true,
            businessName: true,
            logoUrl: true,
            rating: true,
          },
        },
        variants: {
          where: { isAvailable: true },
          select: { id: true, name: true, price: true },
          take: 3,
        },
      },
    });

    const productMap = new Map(products.map(p => [p.id, p]));
    const favoritesWithProducts = favorites.map(f => ({
      id: f.id,
      createdAt: f.createdAt,
      product: productMap.get(f.productId),
    })).filter(f => f.product);

    return sendSuccess(res, { favorites: favoritesWithProducts });
  } catch (error) {
    handleError(res, error);
  }
};

// Add Product to Favorites
// POST /users/favorites
export const addFavorite = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.sub;
    if (!userId) throw new AppError(401, "Unauthorized");

    const { productId } = req.body;
    if (!productId) throw new AppError(400, "Product ID is required");

    const isValidObjectId = /^[a-fA-F0-9]{24}$/.test(productId);
    if (!isValidObjectId) {
      throw new AppError(400, "Invalid Product ID format");
    }

    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: {
        vendor: {
          select: {
            id: true,
            businessName: true,
            logoUrl: true,
          },
        },
      },
    });
    if (!product) throw new AppError(404, "Product not found");

    const existingFavorite = await prisma.favorite.findUnique({
      where: {
        userId_productId: {
          userId,
          productId,
        },
      },
    });

    if (existingFavorite) {
      return sendSuccess(res, { message: "Product already in favorites" });
    }

    const favorite = await prisma.favorite.create({
      data: {
        userId,
        productId,
      },
    });

    return sendSuccess(res, { favorite: { ...favorite, product } }, 201);
  } catch (error) {
    handleError(res, error);
  }
};

// Remove Product from Favorites
// DELETE /users/favorites/:productId
export const removeFavorite = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.sub;
    if (!userId) throw new AppError(401, "Unauthorized");

    const { productId } = req.params;
    if (!productId) throw new AppError(400, "Product ID is required");

    const isValidObjectId = /^[a-fA-F0-9]{24}$/.test(productId);
    if (!isValidObjectId) {
      throw new AppError(400, "Invalid Product ID format");
    }

    const favorite = await prisma.favorite.findUnique({
      where: {
        userId_productId: {
          userId,
          productId,
        },
      },
    });

    if (!favorite) {
      throw new AppError(404, "Favorite not found");
    }

    await prisma.favorite.delete({
      where: { id: favorite.id },
    });

    return sendSuccess(res, { message: "Removed from favorites" });
  } catch (error) {
    handleError(res, error);
  }
};

// Change User Password If Loging
// PUT /users/password
export const changePassWord = async (req: Request, res: Response) => {
  try {
    const id = req.user?.sub;
    const { email, password, confirmPassword } = req.body || {};

    if (!isValidEmail(email))
      throw new AppError(400, "Valid email is required");
    if (!password || !confirmPassword) {
      throw new AppError(400, "Password and confirmPassword are required");
    }
    if (password !== confirmPassword) {
      throw new AppError(400, "Passwords do not match");
    }
    validatePassword(password);

    // Hash password BEFORE calling helper (helper expects hashed value for persistence)
    const passwordHash = await hashPassword(password);

    // call helper which validates token and updates password
    await handlePasswordReset(email, passwordHash, passwordHash, "user", {
      userId: id,
    });

    return sendSuccess(
      res,
      { message: "Password reset successfully. You can now login." },
      200,
    );
  } catch (error) {
    handleError(res, error);
  }
};

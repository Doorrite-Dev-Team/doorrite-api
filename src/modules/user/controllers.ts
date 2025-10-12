import prisma from "@config/db";
import { AppError, handleError, sendSuccess } from "@lib/utils/AppError";
import { isValidNigerianPhone } from "@modules/auth/helper";
import { Request, Response } from "express";

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
    const user = await prisma.user.findUnique({
      where: { id },
    });
    if (!user) throw new AppError(404, "User not found");
    return sendSuccess(res, { user }, 200);
  } catch (err) {
    return handleError(res, err);
  }
};

// Get Current User Profile
// GET api/v1/users/me
export const getCurrentUserProfile = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['User']
   * #swagger.summary = 'Get current user profile'
   * #swagger.description = 'Retrieves the profile of the currently authenticated user.'
   * #swagger.security = [{ "bearerAuth": [] }]
   */
  try {
    const userId = req.user?.sub;
    if (!userId) throw new AppError(401, "Unauthorized");

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) throw new AppError(404, "User not found");
    return sendSuccess(res, { user }, 200);
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
      new AppError(400, "No valid update fields provided")
    );
  }

  // Extra validation example

  // ✅ Collect validation errors instead of failing one by one
  const errors: string[] = [];

  if (data.fullName && data.fullName.trim().length === 0) {
    errors.push("Full name cannot be empty");
  }

  if (
    data.address &&
    (typeof data.address !== "object" || Array.isArray(data.address))
  ) {
    errors.push("Address must be a valid JSON object");
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

    const updatedUser = await prisma.user.update({
      where: { id },
      data, // ✅ only whitelisted fields
    });

    return sendSuccess(res, {
      message: "User updated successfully",
      user: updatedUser,
    });
  } catch (err) {
    return handleError(res, err);
  }
};

// Get User Orders with pagination
//response : {  "data": [...],  "pagination": {    "totalItems": 95,    "totalPages": 10,    "currentPage": 3,    "pageSize": 10,    "hasNext": true,    "hasPrev": true  }}
// GET /users/orders/
export const getUserOrders = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['User', 'User Orders']
   * #swagger.summary = 'Get user orders'
   * #swagger.description = 'Retrieves a paginated list of orders for the currently authenticated user.'
   * #swagger.security = [{ "bearerAuth": [] }]
   * #swagger.parameters['page'] = { in: 'query', description: 'Page number', type: 'integer' }
   * #swagger.parameters['pageSize'] = { in: 'query', description: 'Page size', type: 'integer' }
   */
  try {
    const userId = req.user?.sub;
    if (!userId) throw new AppError(401, "Unauthorized");
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 10;
    const skip = (page - 1) * pageSize;
    const take = pageSize;

    const [totalItems, orders] = await Promise.all([
      prisma.order.count({ where: { id: userId } }),
      prisma.order.findMany({
        where: { id: userId },
        include: {
          items: {
            include: { product: true },
          },
        },
        skip,
        take,
        orderBy: { createdAt: "desc" },
      }),
    ]);
    const totalPages = Math.ceil(totalItems / pageSize);

    const pagination = {
      totalItems,
      totalPages,
      currentPage: page,
      pageSize,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    };

    return sendSuccess(res, { orders, pagination }, 200);
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
   * #swagger.parameters['body'] = { in: 'body', description: 'Review data', required: true, schema: { type: 'object', properties: { targetId: { type: 'string' }, targetType: { type: 'string', enum: ['vendor', 'rider', 'product'] }, rating: { type: 'integer', minimum: 1, maximum: 5 }, comment: { type: 'string' } } } }
   */
  try {
    const userId = req.user?.sub;
    if (!userId) throw new AppError(401, "Unauthorized");

    const { targetId, targetType, rating, comment } = req.body;

    // Basic validation
    if (!targetId || !targetType || !rating) {
      throw new AppError(400, "targetId, targetType, and rating are required");
    }
    if (!["vendor", "rider", "product"].includes(targetType)) {
      throw new AppError(400, "Invalid targetType");
    }
    if (rating < 1 || rating > 5) {
      throw new AppError(400, "Rating must be between 1 and 5");
    }

    const review = await prisma.review.create({
      data: {
        userId,
        rating,
        comment,
        ...(targetType === "vendor" && { vendorId: targetId }),
        ...(targetType === "rider" && { riderId: targetId }),
        ...(targetType === "product" && { productId: targetId }),
      },
    });

    return sendSuccess(res, { review }, 201);
  } catch (error) {
    handleError(res, error);
  }
}

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
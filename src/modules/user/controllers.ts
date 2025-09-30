import prisma from "@config/db";
import { AppError, handleError, sendSuccess } from "@lib/utils/AppError";
import { isValidNigerianPhone } from "@modules/auth/helper";
import { Request, Response } from "express";

// Get User by ID
// GET api/v1/users/:id
export const getUser = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.sub;
    if (!userId) throw new AppError(401, "Unauthorized");

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) throw new AppError(404, "User not found");
    return sendSuccess(res, { user }, 200);
  } catch (err) {
    return handleError(res, err);
  }
};

// Get Current User Profile
// GET api/v1/users/profile
export const getCurrentUserProfile = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.sub;
    if (!userId) throw new AppError(401, "Unauthorized");

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        orders: true,
      },
    });
    if (!user) throw new AppError(404, "User not found");
    return sendSuccess(res, { user }, 200);
  } catch (error) {
    handleError(res, error);
  }
};

// Update User Profile
// PUT api/v1/users/profile
export const updateUserProfile = async (req: Request, res: Response) => {
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

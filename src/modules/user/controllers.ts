import prisma from "@config/db";
import { AppError, handleError, sendSuccess } from "@modules/auth/helper";
import { Request, Response } from "express";

export const getUser = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.sub;
    if (!userId) throw new AppError(401, "Unauthorized");

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        fullName: true,
        email: true,
        phoneNumber: true,
        role: true,
      },
    });
    if (!user) throw new AppError(404, "User not found");
    return sendSuccess(res, { user }, 200);
  } catch (err) {
    return handleError(res, err);
  }
};

export const updateUserProfile = async (req: Request, res: Response) => {
  const { id, ...data } = req.body;

  if (!id) {
    return handleError(res, new AppError(400, "User ID is required"));
  }

  if (Object.keys(data).length === 0) {
    return handleError(res, new AppError(400, "No update fields provided"));
  }

  try {
    // 1. Find product
    const user = await prisma?.user.findUnique({
      where: { id },
    });

    if (!user) {
      throw new AppError(404, "user not found");
    }

    // 2. Authorization check
    if (user.id !== req.user?.sub) {
      throw new AppError(403, "Unauthorized");
    }

    // 3. Update user
    const updatedUser = await prisma?.menuItem.update({
      where: { id },
      data,
    });

    // 4. Respond success
    return sendSuccess(res, {
      message: "user updated successfully",
      user: updatedUser,
    });
  } catch (err) {
    return handleError(res, err);
  }
};

export const updateUserImage = async (req: Request, res: Response) => {
  const { imageFile, id } = req.body || {};

  if (!id) {
    return handleError(res, new AppError(400, "User ID is required"));
  }
  if (!imageFile) {
    return handleError(res, new AppError(400, "File Data is required"));
  }

  try {
    const user = await prisma.user.findUnique({ where: { id } });

    if (!user) {
      throw new AppError(404, "user not found");
    }

    // 2. Authorization check
    if (user.id !== req.user?.sub) {
      throw new AppError(403, "Unauthorized");
    }

    const imageUrl = "";

    const updatedUser = await prisma?.menuItem.update({
      where: { id },
      data: {
        imageUrl,
      },
    });

    return sendSuccess(res, {
      message: "user updated successfully",
      imageUrl,
    });
  } catch (error) {
    handleError(res, error);
  }
};
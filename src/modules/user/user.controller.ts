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
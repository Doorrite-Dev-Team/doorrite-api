import { Response } from "express";
import { Prisma } from "generated/prisma";

export class AppError extends Error {
  status: number;
  details?: any;
  constructor(status: number, message: string, details?: any) {
    super(message);
    this.status = status;
    this.details = details;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export const sendSuccess = (res: Response, payload: object, status = 200) =>
  res.status(status).json({ ok: true, ...payload });

export const sendFailure = (
  res: Response,
  status = 500,
  message = "Server error",
  details?: any,
) => res.status(status).json({ ok: false, error: message, details });

export const handleError = (res: Response, err: unknown) => {
  if (err instanceof AppError) {
    return sendFailure(res, err.status, err.message, err.details);
  }

  // Prisma & MongoDB Errors
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case "P2002":
        return sendFailure(res, 409, "Unique constraint failed", err.meta);
      case "P2025":
        return sendFailure(res, 404, "Record not found");
      case "P2024":
        return sendFailure(res, 504, "Database connection timed out");
      case "P1001":
        return sendFailure(res, 503, "Cannot reach database server");
      default:
        return sendFailure(res, 400, `Database error: ${err.code}`);
    }
  }

  if (err instanceof Prisma.PrismaClientInitializationError) {
    return sendFailure(res, 503, "Database initialization failed");
  }

  // Redis Errors
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes("redis") || msg.includes("connection lost")) {
      return sendFailure(res, 503, "Cache service unavailable", err.message);
    }
    if (msg.includes("ioredis") && msg.includes("timeout")) {
      return sendFailure(res, 504, "Cache request timed out");
    }
  }

  console.error("Unhandled error:", err);
  return sendFailure(res, 500, "An unexpected error occurred");
};

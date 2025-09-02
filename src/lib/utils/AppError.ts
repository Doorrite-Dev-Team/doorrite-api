import { Response } from "express";

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
  details?: any
) => res.status(status).json({ ok: false, error: message, details });

export const handleError = (res: Response, err: unknown) => {
  if (err instanceof AppError) {
    return sendFailure(res, err.status || 500, err.message, err.details);
  }

  console.error("Unhandled error:", err);
  return sendFailure(res, 500, "An unexpected error occurred");
};

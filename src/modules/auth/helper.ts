// src/modules/auth/helper.ts
import prisma from "@config/db";
import sendmail from "@config/mail";
import { verificationEmailTemplate } from "@lib/emailTemplates";
import { generateNumericOtp, OTPExpiryMinutes } from "@lib/otp";
import crypto from "crypto";
import { Response } from "express";
import { OtpType } from "../../../src/generated/prisma";


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

/* ======================
   Validators
   ====================== */
export const isValidEmail = (s: any) =>
  typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

export const isValidNigerianPhone = (s: any) =>
  typeof s === "string" && /^(\+234|0)[789][01]\d{8}$/.test(s.trim());

export const validatePassword = (password: any) => {
  if (!password || typeof password !== "string" || password.length < 8) {
    throw new AppError(400, "Password must be at least 8 characters");
  }
};

/* ======================
   Rate Limiter
   ====================== */
const rateLimitMap = new Map<string, number>();
export const checkRateLimit = async (
  identifier: string,
  action: string,
  windowMinutes = 1
) => {
  const key = `${identifier}:${action}`;
  const now = Date.now();
  const windowMs = windowMinutes * 60 * 1000;
  const last = rateLimitMap.get(key) || 0;
  if (now - last < windowMs) {
    const timeLeft = Math.ceil((windowMs - (now - last)) / 1000);
    throw new AppError(
      429,
      `Please wait ${timeLeft} seconds before trying again`
    );
  }
  rateLimitMap.set(key, now);
  setTimeout(() => {
    const lastCheck = rateLimitMap.get(key) || 0;
    if (Date.now() - lastCheck >= windowMs) rateLimitMap.delete(key);
  }, windowMs + 2000);
};

/* ======================
   Entity Type Definitions
   ====================== */
type EntityType = "user" | "vendor" | "rider";

type EntityData = {
  id: string;
  email: string;
  fullName?: string;
  businessName?: string;
  phoneNumber: string;
  passwordHash: string;
  isVerified: boolean;
  role?: any;
};

/* ======================
   Entity Lookup Helpers
   ====================== */
export const findEntityByEmail = async (
  email: string,
  entityType: EntityType
): Promise<EntityData | null> => {
  switch (entityType) {
    case "user":
      return await prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          email: true,
          fullName: true,
          phoneNumber: true,
          passwordHash: true,
          isVerified: true,
          role: true,
        },
      });

    case "vendor":
      const vendor = await prisma.vendor.findUnique({
        where: { email },
        select: {
          id: true,
          email: true,
          businessName: true,
          phoneNumber: true,
          passwordHash: true,
          isVerified: true,
        },
      });
      return vendor ? { ...vendor, fullName: vendor.businessName } : null;

    case "rider":
      return await prisma.rider.findUnique({
        where: { email },
        select: {
          id: true,
          email: true,
          fullName: true,
          phoneNumber: true,
          passwordHash: true,
          isVerified: true,
        },
      });

    default:
      throw new AppError(400, "Invalid entity type");
  }
};

export const findEntityByIdentifier = async (
  identifier: string,
  entityType: EntityType
): Promise<EntityData | null> => {
  const isEmail = isValidEmail(identifier);
  const isPhone = isValidNigerianPhone(identifier);

  if (!isEmail && !isPhone) {
    throw new AppError(400, "Identifier must be a valid email or phone number");
  }

  const whereClause = isEmail
    ? { email: identifier }
    : { phoneNumber: identifier };

  switch (entityType) {
    case "user":
      return await prisma.user.findFirst({
        where: whereClause,
        select: {
          id: true,
          email: true,
          fullName: true,
          phoneNumber: true,
          passwordHash: true,
          isVerified: true,
          role: true,
        },
      });

    case "vendor":
      const vendor = await prisma.vendor.findFirst({
        where: whereClause,
        select: {
          id: true,
          email: true,
          businessName: true,
          phoneNumber: true,
          passwordHash: true,
          isVerified: true,
        },
      });
      return vendor ? { ...vendor, fullName: vendor.businessName } : null;

    case "rider":
      return await prisma.rider.findFirst({
        where: whereClause,
        select: {
          id: true,
          email: true,
          fullName: true,
          phoneNumber: true,
          passwordHash: true,
          isVerified: true,
        },
      });

    default:
      throw new AppError(400, "Invalid entity type");
  }
};

export const checkEntityExists = async (
  email: string,
  phoneNumber: string,
  entityType: EntityType
): Promise<EntityData | null> => {
  const whereClause = {
    OR: [{ email }, { phoneNumber }],
  };

  switch (entityType) {
    case "user":
      return await prisma.user.findFirst({
        where: whereClause,
        select: {
          id: true,
          email: true,
          fullName: true,
          phoneNumber: true,
          passwordHash: true,
          isVerified: true,
          role: true,
        },
      });

    case "vendor":
      const vendor = await prisma.vendor.findFirst({
        where: whereClause,
        select: {
          id: true,
          email: true,
          businessName: true,
          phoneNumber: true,
          passwordHash: true,
          isVerified: true,
        },
      });
      return vendor ? { ...vendor, fullName: vendor.businessName } : null;

    case "rider":
      return await prisma.rider.findFirst({
        where: whereClause,
        select: {
          id: true,
          email: true,
          fullName: true,
          phoneNumber: true,
          passwordHash: true,
          isVerified: true,
        },
      });

    default:
      throw new AppError(400, "Invalid entity type");
  }
};

/* ======================
   OTP Management
   ====================== */
export const createAndSendOtp = async (
  email: string,
  entityType: EntityType,
  otpType: OtpType = OtpType.EMAIL_VERIFICATION
) => {
  await checkRateLimit(email, `${entityType}_${otpType.toLowerCase()}`, 1);

  const entity = await findEntityByEmail(email, entityType);
  if (!entity) throw new AppError(404, `${entityType} not found`);

  // Check if entity needs to be verified for password reset
  if (otpType === OtpType.PASSWORD_RESET && !entity.isVerified) {
    throw new AppError(
      400,
      "Please verify your account before requesting a password reset"
    );
  }

  const code = generateNumericOtp(6);
  const expiresAt = new Date(Date.now() + OTPExpiryMinutes() * 60 * 1000);

  // Get entity reference field
  const entityRefField = {
    user: { userId: entity.id },
    vendor: { vendorId: entity.id },
    rider: { riderId: entity.id },
  }[entityType];

  // Create or update OTP
  const existingOtp = await prisma.otp.findFirst({
    where: entityRefField,
  });

  if (existingOtp) {
    await prisma.otp.update({
      where: { id: existingOtp.id },
      data: {
        code,
        type: otpType,
        verified: false,
        expiresAt,
        attempts: 0,
      },
    });
  } else {
    await prisma.otp.create({
      data: {
        code,
        type: otpType,
        verified: false,
        expiresAt,
        ...entityRefField,
      },
    });
  }

  const tpl = verificationEmailTemplate(
    entity.fullName || entity.businessName || "",
    code
  );

  try {
    await sendmail(entity.email, tpl.subject, tpl.text, tpl.html);
  } catch (err) {
    // Rollback OTP if email fails
    await prisma.otp.deleteMany({ where: entityRefField }).catch(() => {});
    throw new AppError(502, "Failed to send email. Please try again later");
  }
};

export const verifyOtpCode = async (
  email: string,
  otpCode: string,
  entityType: EntityType,
  otpType: OtpType = OtpType.EMAIL_VERIFICATION
): Promise<{ entity: EntityData; otpId: string }> => {
  if (
    !otpCode ||
    String(otpCode).length !== 6 ||
    !/^\d{6}$/.test(String(otpCode))
  ) {
    throw new AppError(400, "OTP must be a 6 digit number");
  }

  const entity = await findEntityByEmail(email, entityType);
  if (!entity) throw new AppError(404, `${entityType} not found`);

  const entityRefField = {
    user: { userId: entity.id },
    vendor: { vendorId: entity.id },
    rider: { riderId: entity.id },
  }[entityType];

  const otp = await prisma.otp.findFirst({
    where: {
      ...entityRefField,
      type: otpType,
    },
  });

  if (!otp) throw new AppError(404, "No OTP pending for this user");

  // Check attempts
  if (otp.attempts >= 5) {
    await prisma.otp.delete({ where: { id: otp.id } });
    throw new AppError(
      400,
      "Too many failed attempts. Please request a new OTP"
    );
  }

  if (otp.expiresAt < new Date()) {
    await prisma.otp.delete({ where: { id: otp.id } });
    throw new AppError(400, "OTP expired");
  }

  if (otp.code !== String(otpCode)) {
    await prisma.otp.update({
      where: { id: otp.id },
      data: { attempts: otp.attempts + 1 },
    });
    throw new AppError(400, "Invalid OTP");
  }

  return { entity, otpId: otp.id };
};

export const markEntityAsVerified = async (
  entityId: string,
  entityType: EntityType
) => {
  switch (entityType) {
    case "user":
      await prisma.user.update({
        where: { id: entityId },
        data: { isVerified: true },
      });
      break;
    case "vendor":
      await prisma.vendor.update({
        where: { id: entityId },
        data: { isVerified: true },
      });
      break;
    case "rider":
      await prisma.rider.update({
        where: { id: entityId },
        data: { isVerified: true },
      });
      break;
    default:
      throw new AppError(400, "Invalid entity type");
  }
};

export const updateEntityPassword = async (
  entityId: string,
  passwordHash: string,
  entityType: EntityType
) => {
  switch (entityType) {
    case "user":
      await prisma.user.update({
        where: { id: entityId },
        data: { passwordHash },
      });
      break;
    case "vendor":
      await prisma.vendor.update({
        where: { id: entityId },
        data: { passwordHash },
      });
      break;
    case "rider":
      await prisma.rider.update({
        where: { id: entityId },
        data: { passwordHash },
      });
      break;
    default:
      throw new AppError(400, "Invalid entity type");
  }
};

/* ======================
   Common Auth Flows
   ====================== */
export const processOtpVerification = async (
  email: string,
  otpCode: string,
  entityType: EntityType,
  purpose: "verify" | "reset" = "verify"
): Promise<{ entity: EntityData; resetToken?: string }> => {
  const otpType =
    purpose === "reset" ? OtpType.PASSWORD_RESET : OtpType.EMAIL_VERIFICATION;
  const { entity, otpId } = await verifyOtpCode(
    email,
    otpCode,
    entityType,
    otpType
  );

  if (purpose === "verify") {
    // Mark entity as verified
    await markEntityAsVerified(entity.id, entityType);

    // Clean up OTP
    await prisma.otp.delete({ where: { id: otpId } });

    return { entity };
  } else {
    // For password reset, mark OTP as verified and extend expiry
    const resetToken = generateHexToken(32);
    const resetExpiry = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    await prisma.otp.update({
      where: { id: otpId },
      data: {
        verified: true,
        expiresAt: resetExpiry,
      },
    });

    return { entity, resetToken };
  }
};

export const handlePasswordReset = async (
  email: string,
  newPassword: string,
  confirmPassword: string,
  entityType: EntityType
) => {
  if (!isValidEmail(email) || !newPassword || !confirmPassword) {
    throw new AppError(400, "Please provide all required fields");
  }
  if (newPassword !== confirmPassword) {
    throw new AppError(400, "Passwords do not match");
  }
  validatePassword(newPassword);

  const entity = await findEntityByEmail(email, entityType);
  if (!entity) throw new AppError(404, `${entityType} not found`);

  const entityRefField = {
    user: { userId: entity.id },
    vendor: { vendorId: entity.id },
    rider: { riderId: entity.id },
  }[entityType];

  const otp = await prisma.otp.findFirst({
    where: {
      ...entityRefField,
      type: OtpType.PASSWORD_RESET,
      verified: true,
    },
  });

  if (!otp) {
    throw new AppError(
      404,
      "Reset session missing. Please start the process again."
    );
  }

  if (otp.expiresAt < new Date()) {
    await prisma.otp.delete({ where: { id: otp.id } });
    throw new AppError(
      400,
      "Reset session expired. Please start the process again."
    );
  }

  return { entity, otpId: otp.id };
};

export const checkExistingEntity = async (
  email: string,
  phoneNumber: string,
  entityType: EntityType
) => {
  const existing = await checkEntityExists(email, phoneNumber, entityType);

  if (existing) {
    if (!existing.isVerified) {
      await createAndSendOtp(
        existing.email,
        entityType,
        OtpType.EMAIL_VERIFICATION
      );
      return {
        message: `${entityType} exists but not verified. New OTP sent to email.`,
        entityId: existing.id,
        shouldCreateNew: false,
      };
    }
    throw new AppError(409, `${entityType} already exists. Please login`);
  }

  return { shouldCreateNew: true };
};

/* ======================
   Utilities
   ====================== */
export const generateHexToken = (len = 32) =>
  crypto.randomBytes(len).toString("hex");

export const cleanupExpiredOTPs = async () => {
  try {
    const now = new Date();
    await prisma.otp.deleteMany({ where: { expiresAt: { lt: now } } });
    console.log("Expired OTPs cleaned up");
  } catch (err) {
    console.error("cleanupExpiredOTPs error:", err);
  }
};

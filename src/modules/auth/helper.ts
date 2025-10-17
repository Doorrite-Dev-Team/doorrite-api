// src/modules/auth/helper.ts
import prisma from "@config/db";
import sendmail from "@config/mail";
import {
  passwordResetEmailTemplate,
  verificationEmailOTPTemplate,
} from "@lib/emailTemplates";

// Redis OTP utilities
import {
  createOtp,
  verifyOtp as redisVerifyOtp,
  // getOtpStatus,
  deleteOtp,
  createResetToken,
  validateResetToken,
  deleteResetToken,
  OTP_TTL_SECONDS,
} from "@config/redis";

import { AppError } from "@lib/utils/AppError";
import { OtpType } from "../../generated/prisma";

/* Validators (unchanged) */
export const isValidEmail = (s: any) =>
  typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

export const isValidNigerianPhone = (s: any) =>
  typeof s === "string" && /^(\+234|0)[789][01]\d{8}$/.test(s.trim());

export const validatePassword = (password: any) => {
  if (!password || typeof password !== "string" || password.length < 8) {
    throw new AppError(400, "Password must be at least 8 characters");
  }
};

/* Rate limiter (unchanged) */
// const rateLimitMap = new Map<string, number>();
// export const checkRateLimit = async (
//   identifier: string,
//   action: string,
//   windowMinutes = 1
// ) => {
//   const key = `${identifier}:${action}`;
//   const now = Date.now();
//   const windowMs = windowMinutes * 60 * 1000;
//   const last = rateLimitMap.get(key) || 0;
//   if (now - last < windowMs) {
//     const timeLeft = Math.ceil((windowMs - (now - last)) / 1000);
//     throw new AppError(
//       429,
//       `Please wait ${timeLeft} seconds before trying again`
//     );
//   }
//   rateLimitMap.set(key, now);
//   setTimeout(() => {
//     const lastCheck = rateLimitMap.get(key) || 0;
//     if (Date.now() - lastCheck >= windowMs) rateLimitMap.delete(key);
//   }, windowMs + 2000);
// };

/* Entity helpers (unchanged) */
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
    case "vendor": {
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
    }
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
  const whereClause = { OR: [{ email }, { phoneNumber }] };
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
   OTP Management (Redis only)
   ====================== */
/**
 * createAndSendOtp
 * - uses Redis via createOtp(...) to issue OTP
 * - does NOT persist OTP in Mongo
 * - sends email containing the OTP
 */
export const createAndSendOtp = async (
  email: string,
  entityType: EntityType,
  otpType: OtpType = OtpType.EMAIL_VERIFICATION
) => {
  // await checkRateLimit(email, `${entityType}_${String(otpType).toLowerCase()}`, 1);

  const entity = await findEntityByEmail(email, entityType);

  if (!entity) throw new AppError(404, `${entityType} not found`);

  if (otpType === OtpType.PASSWORD_RESET && !entity.isVerified) {
    throw new AppError(
      400,
      "Please verify your account before requesting a password reset"
    );
  }

  const otpTypeStr = String(otpType);
  const redisRes = await createOtp(otpTypeStr, email);

  if (!redisRes.ok) {
    if (redisRes.reason === "exists") {
      throw new AppError(
        409,
        `OTP already sent. Try again after ${
          redisRes.ttlSeconds ?? Math.ceil(OTP_TTL_SECONDS / 60)
        } seconds`
      );
    }
    throw new AppError(500, "Failed to create OTP");
  }

  // Send email with the real code (do NOT persist real code anywhere)
  const tpl =
    otpType === "EMAIL_VERIFICATION"
      ? verificationEmailOTPTemplate(
          entity.fullName || entity.businessName || "",
          redisRes.code
        )
      : passwordResetEmailTemplate(
          entity.fullName || entity.businessName || "",
          redisRes.code
        );

  try {
    await sendmail(entity.email, tpl.subject, tpl.text, tpl.html);
  } catch (err) {
    // On send failure: delete redis OTP to avoid dangling state
    await deleteOtp(otpTypeStr, email).catch(() => {});
    throw new AppError(502, "Failed to send email. Please try again later");
  }

  return { ok: true, message: "OTP sent" };
};

/**
 * verifyOtpCode
 * - primary verification via Redis
 * - returns { entity } on success
 */
export const verifyOtpCode = async (
  email: string,
  otpCode: string,
  entityType: EntityType,
  otpType: OtpType = OtpType.EMAIL_VERIFICATION
): Promise<{ entity: EntityData }> => {
  if (
    !otpCode ||
    String(otpCode).length !== 6 ||
    !/^\d{6}$/.test(String(otpCode))
  ) {
    throw new AppError(400, "OTP must be a 6 digit number");
  }

  const entity = await findEntityByEmail(email, entityType);
  if (!entity) throw new AppError(404, `${entityType} not found`);

  const otpTypeStr = String(otpType);
  const redisRes = await redisVerifyOtp(otpTypeStr, email, otpCode);

  if (!redisRes.ok) {
    if (
      redisRes.reason === "blocked" ||
      redisRes.reason === "blocked_after_failed"
    ) {
      throw new AppError(
        429,
        "Too many failed attempts. Wait until OTP expires."
      );
    }
    if (redisRes.reason === "expired") {
      throw new AppError(400, "OTP expired");
    }
    if (redisRes.reason === "invalid") {
      throw new AppError(400, "Invalid OTP");
    }
    throw new AppError(400, "Invalid or expired OTP");
  }

  // success
  return { entity };
};

/* ======================
   Flows: verify vs reset
   ====================== */

/**
 * processOtpVerification
 * - for `verify` purpose: marks entity as verified
 * - for `reset` purpose: returns a resetToken stored in Redis (15 mins)
 */
export const processOtpVerification = async (
  email: string,
  otpCode: string,
  entityType: EntityType,
  purpose: "verify" | "reset" = "verify"
): Promise<{ entity: EntityData; resetToken?: string }> => {
  const otpType =
    purpose === "reset" ? OtpType.PASSWORD_RESET : OtpType.EMAIL_VERIFICATION;

  // verify in Redis
  const { entity } = await verifyOtpCode(email, otpCode, entityType, otpType);

  if (purpose === "verify") {
    await markEntityAsVerified(entity.id, entityType);
    return { entity };
  }

  // reset flow: generate a reset token (stored in Redis for 15 minutes)
  const { token } = await createResetToken(String(otpType), email, 15 * 60);
  return { entity, resetToken: token };
};

/**
 * handlePasswordReset
 * - now requires resetToken (from processOtpVerification)
 * - validates token in Redis, updates password, deletes token
 */
export const handlePasswordReset = async (
  email: string,
  newPassword: string,
  confirmPassword: string,
  entityType: EntityType,
  resetToken: string
) => {
  if (!isValidEmail(email) || !newPassword || !confirmPassword || !resetToken) {
    throw new AppError(400, "Please provide all required fields");
  }
  if (newPassword !== confirmPassword) {
    throw new AppError(400, "Passwords do not match");
  }
  validatePassword(newPassword);

  const entity = await findEntityByEmail(email, entityType);
  if (!entity) throw new AppError(404, `${entityType} not found`);

  // check reset token in Redis
  const isValidToken = await validateResetToken(
    String(OtpType.PASSWORD_RESET),
    email,
    resetToken
  );
  if (!isValidToken) {
    throw new AppError(
      400,
      "Reset session missing or expired. Please start the process again."
    );
  }

  // update password
  await updateEntityPassword(
    entity.id,
    /* assume hash already */ newPassword,
    entityType
  );

  // cleanup reset token
  await deleteResetToken(
    String(OtpType.PASSWORD_RESET),
    email,
    resetToken
  ).catch(() => {});

  return { entity };
};

/* Mark/update helpers (unchanged) */
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

/* Registration helper & other utilities (unchanged except removing prisma otp references) */
export const checkExistingEntity = async (
  email: string,
  phoneNumber: string,
  entityType: EntityType
) => {
  const existing = await checkEntityExists(email, phoneNumber, entityType);

  // --- Case 1: No existing entity at all
  if (!existing) {
    return { shouldCreateNew: true };
  }

  const emailMatches = existing.email === email;
  const phoneMatches = existing.phoneNumber === phoneNumber;

  // --- Case 2: Both match
  if (emailMatches && phoneMatches) {
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
    // Registration already complete → redirect to login
    // throw new AppError(409, `${entityType} already exists. Please login`);
    console.error(`${entityType} already registered. Redirecting to login...`);
    return { shouldCreateNew: false, redirectToLogin: true };
  }

  // --- Case 3: One matches, but the other doesn't
  if (!existing.isVerified) {
    // Delete unverified/incomplete registration before recreating
    await deleteIncompleteEntity(existing.id, entityType);
    console.log(
      `Deleted previous unverified ${entityType} with mismatched credentials.`
    );
    return { shouldCreateNew: true };
  }

  // --- Case 4: Verified but mismatched → registration complete
  // So user must login instead of registering again
  // throw new AppError(409, `${entityType} already registered. Please login`);
  console.error(
    `${entityType} is verified but credentials mismatch. Redirecting to login...`
  );
  return { shouldCreateNew: false, redirectToLogin: true };
};

export const deleteIncompleteEntity = async (
  id: string,
  entityType: EntityType
) => {
  switch (entityType) {
    case "user":
      return prisma.user.delete({ where: { id } });
    case "vendor":
      return prisma.vendor.delete({ where: { id } });
    case "rider":
      return prisma.rider.delete({ where: { id } });
    default:
      throw new AppError(400, "Invalid entity type");
  }
};

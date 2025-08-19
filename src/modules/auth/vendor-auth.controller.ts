// src/controllers/vendorAuth.ts
import {
  clearAuthCookies,
  getAccessTokenFromReq,
  setAuthCookies
} from "@config/cookies";
import prisma from "@config/db";
import {
  makeAccessTokenForVendor,
  makeRefreshTokenForVendor,
  verifyJwt,
} from "@config/jwt";
import { hashPassword, verifyPassword } from "@lib/hash";
import {
  AppError,
  checkExistingEntity,
  createAndSendOtp,
  findEntityByIdentifier,
  handleError,
  handlePasswordReset,
  isValidEmail,
  processOtpVerification,
  sendSuccess,
  updateEntityPassword,
  validatePassword,
} from "@modules/auth/helper";
import { Request, Response } from "express";
import { OtpType } from "../../../src/generated/prisma";

/**
 * Local validator for vendor payload.
 * Throws AppError on invalid input.
 */
const validateVendorData = (data: any) => {
  const { businessName, address, categoryId, email, phoneNumber, password } =
    data || {};

  if (
    !businessName ||
    typeof businessName !== "string" ||
    businessName.trim().length < 2
  ) {
    throw new AppError(
      400,
      "Business name is required and must be at least 2 characters"
    );
  }

  if (!address || typeof address !== "object") {
    throw new AppError(400, "Address object is required");
  }

  if (!address.street || !address.city || !address.state) {
    throw new AppError(400, "Address must include street, city, and state");
  }

  if (!categoryId || typeof categoryId !== "string") {
    throw new AppError(400, "Category ID is required");
  }

  if (!isValidEmail(email)) {
    throw new AppError(400, "Valid email is required");
  }

  if (!phoneNumber || typeof phoneNumber !== "string") {
    throw new AppError(400, "Phone number is required");
  }

  validatePassword(password);
};

/* =========================
   Vendor Registration
   ========================= */
export const createVendor = async (req: Request, res: Response) => {
  try {
    const {
      businessName,
      email,
      phoneNumber,
      password,
      address,
      categoryId,
      subcategoryId,
      logoUrl,
    } = req.body || {};

    // Basic validation (throws AppError on invalid)
    validateVendorData({
      businessName,
      email,
      phoneNumber,
      password,
      address,
      categoryId,
    });

    // ensure category exists
    const category = await prisma.category.findUnique({
      where: { id: categoryId },
    });
    if (!category) throw new AppError(400, "Invalid categoryId");

    // Check if vendor (email/phone) already exists
    const registrationResult = await checkExistingEntity(
      email,
      phoneNumber,
      "vendor"
    );

    if (!registrationResult.shouldCreateNew) {
      // If exists but not verified, checkExistingEntity should have resent OTP and returned message
      return sendSuccess(
        res,
        {
          message: registrationResult.message,
          vendorId: registrationResult.entityId,
        },
        200
      );
    }

    // Create vendor (not verified, not active). Admin will set isActive = true to approve.
    const passwordHash = await hashPassword(password);
    const newVendor = await prisma.vendor.create({
      data: {
        email: email.trim(),
        businessName: businessName.trim(),
        phoneNumber: phoneNumber.trim(),
        passwordHash,
        address,
        categoryId,
        subcategoryId: subcategoryId || undefined,
        logoUrl: logoUrl || undefined,
        isVerified: false,
        isActive: false, // requires admin approval
      },
    });

    // Send email OTP for verification
    await createAndSendOtp(
      newVendor.email,
      "vendor",
      OtpType.EMAIL_VERIFICATION
    );

    return sendSuccess(
      res,
      {
        message:
          "Vendor registered. Verification code sent to email. Admin approval required before your account can be used.",
        vendorId: newVendor.id,
      },
      201
    );
  } catch (err) {
    return handleError(res, err);
  }
};

/* =========================
   OTP: request & verify (vendor)
   ========================= */
export const createVendorOtp = async (req: Request, res: Response) => {
  try {
    const { email } = req.body || {};
    if (!isValidEmail(email)) throw new AppError(400, "Valid email required");

    await createAndSendOtp(email, "vendor", OtpType.EMAIL_VERIFICATION);
    return sendSuccess(
      res,
      { message: "Verification code sent to vendor email" },
      200
    );
  } catch (err) {
    return handleError(res, err);
  }
};

export const verifyVendorOtp = async (req: Request, res: Response) => {
  try {
    const { email, otp, purpose } = req.body || {};
    if (!isValidEmail(email)) throw new AppError(400, "Valid email required");

    const result = await processOtpVerification(
      email,
      otp,
      "vendor",
      purpose === "reset" ? "reset" : "verify"
    );

    if (purpose === "reset") {
      return sendSuccess(
        res,
        {
          message: "OTP verified for password reset",
          resetToken: result.resetToken,
        },
        200
      );
    } else {
      // Email verified — markEntityAsVerified already called inside processOtpVerification for 'verify'.
      // BUT vendor still requires admin approval (isActive=false). So do NOT log in automatically.
      return sendSuccess(
        res,
        {
          message:
            "Email verified. Your account is pending admin approval. You will be notified when approved.",
        },
        200
      );
    }
  } catch (err) {
    return handleError(res, err);
  }
};

/* =========================
   Login / Logout (vendor)
   ========================= */
export const loginVendor = async (req: Request, res: Response) => {
  try {
    const { identifier, password } = req.body || {}; // identifier = email or phone

    if (!identifier || !password)
      throw new AppError(400, "Identifier and password are required");

    const vendor = await findEntityByIdentifier(identifier, "vendor");
    if (!vendor) throw new AppError(401, "Invalid credentials");

    // must have verified email first
    if (!vendor.isVerified)
      throw new AppError(403, "Please verify your email before logging in");

    // must be approved by admin (isActive)
    // vendor model uses `isActive` to indicate admin-enabled
    const dbVendor = await prisma.vendor.findUnique({
      where: { id: vendor.id },
      select: { isActive: true },
    });
    if (!dbVendor || !dbVendor.isActive) {
      throw new AppError(403, "Account pending admin approval");
    }

    const isPasswordValid = await verifyPassword(vendor.passwordHash, password);
    if (!isPasswordValid) throw new AppError(401, "Invalid credentials");

    // Issue tokens (cookies)
    // NOTE: makeAccessTokenForVendor / makeRefreshTokenForVendor signature assumed to accept vendorId
    const access = makeAccessTokenForVendor(vendor.id);
    const refresh = makeRefreshTokenForVendor(vendor.id);
    setAuthCookies(res, access, refresh, "vendor");


    return sendSuccess(
      res,
      {
        vendor: {
          id: vendor.id,
          email: vendor.email,
          businessName:
            (vendor as any).fullName || (vendor as any).businessName,
        },
      },
      200
    );
  } catch (err) {
    return handleError(res, err);
  }
};

export const logoutVendor = async (req: Request, res: Response) => {
  try {
    clearAuthCookies(res, "vendor");

    return sendSuccess(res, { message: "Logged out" }, 200);
  } catch (err) {
    return handleError(res, err);
  }
};

/* =========================
   Password Reset (vendor)
   ========================= */
export const forgottenVendorPassword = async (req: Request, res: Response) => {
  try {
    const { email } = req.body || {};
    if (!isValidEmail(email))
      throw new AppError(400, "Valid email is required");

    // Send OTP for password reset — vendor must already exist and be verified
    await createAndSendOtp(email, "vendor", OtpType.PASSWORD_RESET);
    return sendSuccess(
      res,
      { message: "Password reset code sent to your email" },
      200
    );
  } catch (err) {
    return handleError(res, err);
  }
};

export const resetVendorPassword = async (req: Request, res: Response) => {
  try {
    const { email, password, confirmPassword } = req.body || {};

    const { entity, otpId } = await handlePasswordReset(
      email,
      password,
      confirmPassword,
      "vendor"
    );

    const passwordHash = await hashPassword(password);
    await updateEntityPassword(entity.id, passwordHash, "vendor");

    // cleanup otp after successful reset
    await prisma.otp.delete({ where: { id: otpId } });

    return sendSuccess(
      res,
      {
        message:
          "Password reset successfully. You can now login after admin approval (if required).",
      },
      200
    );
  } catch (err) {
    return handleError(res, err);
  }
};

/* =========================
   Token Refresh (vendor)
   ========================= */
export const refreshVendorToken = async (req: Request, res: Response) => {
  try {
    const raw = getAccessTokenFromReq(req, "vendor");
    if (!raw) throw new AppError(401, "No refresh token");

    const payload: any = verifyJwt(raw);
    if (!payload?.sub) throw new AppError(401, "Invalid token payload");

    const vendor = await prisma.vendor.findUnique({
      where: { id: payload.sub },
      select: { id: true, isActive: true },
    });
    if (!vendor) throw new AppError(401, "Invalid vendor");

    if (!vendor.isActive)
      throw new AppError(403, "Vendor account not approved");

    const access = makeAccessTokenForVendor(vendor.id);
    const refresh = makeRefreshTokenForVendor(vendor.id);
    setAuthCookies(res, access, refresh, "vendor");


    return sendSuccess(res, { accessToken: access }, 200);
  } catch (err) {
    return handleError(res, err);
  }
};

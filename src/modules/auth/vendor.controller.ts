import {
  clearAuthCookies,
  getAccessTokenFromReq,
  setAuthCookies,
} from "@config/cookies";
import prisma from "@config/db";
import {
  makeAccessTokenForVendor,
  makeRefreshTokenForVendor,
  verifyJwt,
} from "@config/jwt";
import { hashPassword, verifyPassword } from "@lib/hash";
import { AppError, handleError, sendSuccess } from "@lib/utils/AppError";
import {
  checkExistingEntity,
  createAndSendOtp,
  findEntityByIdentifier,
  handlePasswordReset,
  isValidEmail,
  processOtpVerification,
  validatePassword,
} from "@modules/auth/helper";
import { Request, Response } from "express";
import { OtpType } from "../../generated/prisma";
import { createResetToken } from '@config/redis';

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
      categoryIds,
      logoUrl,
    } = req.body || {};

    // Basic validation (throws AppError on invalid)
    validateVendorData({
      businessName,
      email,
      phoneNumber,
      password,
      address,
      categoryIds,
    });

    // Ensure all provided categories exist
    const uniqueCategoryIds: string[] = Array.from(
      new Set((categoryIds as string[]).map((c) => c.trim()))
    );
    const foundCategories = await prisma.category.findMany({
      where: { id: { in: uniqueCategoryIds } },
      select: { id: true },
    });

    if (foundCategories.length !== uniqueCategoryIds.length) {
      throw new AppError(400, "One or more categoryIds are invalid");
    }

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
        logoUrl: logoUrl || undefined,
        isVerified: false,
        isActive: false, // requires admin approval
      },
    });

    // Create VendorCategory links
    // Use Promise.all to create links; safe even if many categories
    await Promise.all(
      uniqueCategoryIds.map((catId) =>
        prisma.vendorCategory.create({
          data: {
            vendorId: newVendor.id,
            categoryId: catId,
          },
        })
      )
    );

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
    const access = makeAccessTokenForVendor(vendor.id);
    const refresh = makeRefreshTokenForVendor(vendor.id);
    setAuthCookies(res, access, refresh, "vendor");

    return sendSuccess(
      res,
      {
        vendor: {
          id: vendor.id,
          email: vendor.email,
          businessName: (vendor as any).businessName,
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

    await createAndSendOtp(email, "vendor", OtpType.PASSWORD_RESET);
    const resetToken = await createResetToken(email, "vendor");

    return sendSuccess(
      res,
      { message: "Password reset code sent to your email", resetToken },
      200
    );
  } catch (err) {
    return handleError(res, err);
  }
};

export const resetVendorPassword = async (req: Request, res: Response) => {
  try {
    const { email, password, confirmPassword, resetToken } = req.body || {};

    if (!resetToken) {
      throw new AppError(400, "Reset token is required");
    }
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
    await handlePasswordReset(
      email,
      passwordHash,
      passwordHash,
      "vendor",
      resetToken
    );

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

function validateVendorData({
  businessName,
  email,
  phoneNumber,
  password,
  address,
  categoryIds,
}: {
  businessName: any;
  email: any;
  phoneNumber: any;
  password: any;
  address: any;
  categoryIds: any;
}) {
  if (
    !businessName ||
    typeof businessName !== "string" ||
    businessName.trim().length < 2
  ) {
    throw new AppError(400, "Business name is required and must be at least 2 characters");
  }
  if (!isValidEmail(email)) {
    throw new AppError(400, "Valid email is required");
  }
  if (
    !phoneNumber ||
    typeof phoneNumber !== "string" ||
    phoneNumber.trim().length < 7
  ) {
    throw new AppError(400, "Valid phone number is required");
  }
  if (!password || typeof password !== "string" || password.length < 6) {
    throw new AppError(400, "Password is required and must be at least 6 characters");
  }
  if (!address || typeof address !== "string" || address.trim().length < 5) {
    throw new AppError(400, "Address is required and must be at least 5 characters");
  }
  if (
    !Array.isArray(categoryIds) ||
    categoryIds.length === 0 ||
    !categoryIds.every((id) => typeof id === "string" && id.trim().length > 0)
  ) {
    throw new AppError(400, "At least one valid categoryId is required");
  }
}


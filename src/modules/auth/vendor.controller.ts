import {
  clearAuthCookies,
  getAccessTokenFromReq,
  setAuthCookies,
} from "@config/cookies";
import prisma from "@config/db";
import { validateCategoryIds } from "@lib/category";
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
import { createResetToken } from "@config/redis";
import { addressSchema } from "@lib/utils/address";
import { Address, OtpType } from "../../generated/prisma";

export const createVendor = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Auth', 'Auth Vendor']
   * #swagger.summary = 'Create a new vendor'
   * #swagger.description = 'Register a new vendor account'
   */
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

    // Ensure provided categoryIds are valid according to in-memory DeliveryCategories
    const uniqueCategoryIds: string[] = Array.from(
      new Set(((categoryIds as string[]) || []).map((c) => String(c).trim()))
    );

    const invalid = validateCategoryIds(uniqueCategoryIds);
    if (invalid.length > 0) {
      throw new AppError(400, `Invalid categoryIds: ${invalid.join(", ")}`);
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
        address:
          typeof address === "string" ? { address } : (address as Address),
        logoUrl: logoUrl || undefined,
        isVerified: false,
        isActive: false, // requires admin approval
      },
    });

    // Optionally create DB links to vendorCategory if your schema has it. This is non-blocking for validation.
    // try {
    //   if (uniqueCategoryIds.length > 0 && prisma.vendorCategory) {
    //     await Promise.all(
    //       uniqueCategoryIds.map((catId) =>
    //         prisma.vendorCategory.create({
    //           data: {
    //             vendorId: newVendor.id,
    //             categoryId: catId,
    //           },
    //         })
    //       )
    //     );
    //   }
    // } catch (e: Error | any) {
    //   // If vendorCategory model doesn't exist or DB insert fails, continue — categories are treated in-memory
    //   // Log the error for debugging but don't block vendor creation
    //   console.warn("vendorCategory linking skipped:", e?.message || e);
    // }

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

export const createVendorOtp = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Auth', 'Auth Vendor']
   * #swagger.summary = 'Create vendor OTP'
   * #swagger.description = 'Send a one-time password to the vendor'
   */
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
  /**
   * #swagger.tags = ['Auth', 'Auth Vendor']
   * #swagger.summary = 'Verify vendor OTP'
   * #swagger.description = 'Verify the one-time password for the vendor'
   */
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

export const loginVendor = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Auth', 'Auth Vendor']
   * #swagger.summary = 'Vendor login'
   * #swagger.description = 'Authenticate and receive a JWT for the vendor'
   */
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

    const isPasswordValid = await verifyPassword(password, vendor.passwordHash);
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
        access,
      },
      200
    );
  } catch (err) {
    return handleError(res, err);
  }
};

export const logoutVendor = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Auth', 'Auth Vendor']
   * #swagger.summary = 'Vendor logout'
   * #swagger.description = 'Log out the currently authenticated vendor'
   */
  try {
    clearAuthCookies(res, "vendor");

    return sendSuccess(res, { message: "Logged out" }, 200);
  } catch (err) {
    return handleError(res, err);
  }
};

export const forgottenVendorPassword = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Auth', 'Auth Vendor']
   * #swagger.summary = 'Forgot vendor password'
   * #swagger.description = 'Initiate the password reset process for the vendor'
   */
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
  /**
   * #swagger.tags = ['Auth', 'Auth Vendor']
   * #swagger.summary = 'Reset vendor password'
   * #swagger.description = 'Reset the vendor password with a valid token'
   */
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

export const refreshVendorToken = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Auth', 'Auth Vendor']
   * #swagger.summary = 'Refresh vendor token'
   * #swagger.description = 'Obtain a new JWT for the vendor using a refresh token'
   */
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

    return sendSuccess(res, { access }, 200);
  } catch (err) {
    return handleError(res, err);
  }
};

export function validateVendorData({
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
  // Business name
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

  // Email
  if (!isValidEmail(email)) {
    throw new AppError(400, "Valid email is required");
  }

  // Phone
  if (
    !phoneNumber ||
    typeof phoneNumber !== "string" ||
    phoneNumber.trim().length < 7
  ) {
    throw new AppError(400, "Valid phone number is required");
  }

  // Password
  if (!password || typeof password !== "string" || password.length < 6) {
    throw new AppError(
      400,
      "Password is required and must be at least 6 characters"
    );
  }

  // Address — supports object or string (for backward compatibility)
  try {
    if (typeof address === "string") {
      if (address.trim().length < 5) {
        throw new Error("Address string too short");
      }
    } else {
      const parsed = addressSchema.safeParse(address);
      if (!parsed.success) {
        throw new AppError(400, parsed.error.message ?? "Invalid address");
      }
    }
  } catch (err: any) {
    throw new AppError(400, `Invalid address: ${err.message || err}`);
  }

  // Category IDs
  if (
    !Array.isArray(categoryIds) ||
    categoryIds.length === 0 ||
    !categoryIds.every((id) => typeof id === "string" && id.trim().length > 0)
  ) {
    throw new AppError(400, "At least one valid categoryId is required");
  }
}

// src/controllers/auth.ts
import {
  clearAuthCookies,
  getRefreshTokenFromReq,
  setAuthCookies,
} from "@config/cookies";
import prisma from "@config/db";
import {
  makeAccessTokenForUser,
  makeRefreshTokenForUser,
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
  isValidNigerianPhone,
  processOtpVerification,
  validatePassword,
} from "@modules/auth/helper";
import { Request, Response } from "express";
import { OtpType } from "../../generated/prisma";
import { createResetToken } from "@config/redis";

/* ======================
   Create User
   ====================== */
export const createUser = async (req: Request, res: Response) => {
  try {
    const { fullName, email, phoneNumber, password } = req.body || {};

    // Validate input
    if (
      !fullName ||
      typeof fullName !== "string" ||
      fullName.trim().length < 2
    ) {
      throw new AppError(
        400,
        "fullName is required and must be at least 2 characters"
      );
    }
    if (!isValidEmail(email)) throw new AppError(400, "Invalid email address");
    if (!isValidNigerianPhone(phoneNumber))
      throw new AppError(400, "Invalid Nigerian phone number");
    validatePassword(password);

    // Check if user exists
    const registrationResult = await checkExistingEntity(
      email,
      phoneNumber,
      "user"
    );

    if (!registrationResult.shouldCreateNew) {
      return sendSuccess(
        res,
        {
          message: registrationResult.message,
          userId: registrationResult.entityId,
        },
        200
      );
    }

    // Create new user
    const passwordHash = await hashPassword(password);
    const newUser = await prisma.user.create({
      data: {
        fullName: fullName.trim(),
        email: email.trim(),
        phoneNumber: phoneNumber.trim(),
        passwordHash,
      },
    });

    // Send OTP (Redis-backed)
    await createAndSendOtp(newUser.email, "user", OtpType.EMAIL_VERIFICATION);

    return sendSuccess(
      res,
      { message: "User created. OTP sent to email.", userId: newUser.id },
      201
    );
  } catch (err) {
    return handleError(res, err);
  }
};

/* ======================
   OTP & Verification
   ====================== */
export const createOtp = async (req: Request, res: Response) => {
  try {
    const { email } = req.body || {};
    if (!isValidEmail(email)) throw new AppError(400, "Valid email required");

    await createAndSendOtp(email, "user", OtpType.EMAIL_VERIFICATION);
    return sendSuccess(
      res,
      { message: "Verification code sent to your email" },
      200
    );
  } catch (err) {
    return handleError(res, err);
  }
};

export const verifyOtp = async (req: Request, res: Response) => {
  try {
    const { email, otp, purpose } = req.body || {};
    if (!isValidEmail(email)) throw new AppError(400, "Valid email required");

    const result = await processOtpVerification(
      email,
      otp,
      "user",
      purpose === "reset" ? "reset" : "verify"
    );

    if (purpose === "reset") {
      // returns resetToken when purpose === 'reset'
      return sendSuccess(
        res,
        {
          message: "OTP verified for Password reset",
          resetToken: result.resetToken,
        },
        200
      );
    } else {
      // Login the user after successful verification
      const access = makeAccessTokenForUser(
        result.entity.id,
        result.entity.role
      );
      const refresh = makeRefreshTokenForUser(result.entity.id);
      setAuthCookies(res, access, refresh, "user");

      return sendSuccess(res, { message: "OTP verified and logged in" }, 200);
    }
  } catch (err) {
    return handleError(res, err);
  }
};

/* ======================
   Login / Logout
   ====================== */
export const login = async (req: Request, res: Response) => {
  try {
    const { identifier, password } = req.body || {};

    const user = await findEntityByIdentifier(identifier, "user");
    if (!user) throw new AppError(401, "Invalid credentials");

    if (!user.isVerified) {
      throw new AppError(403, "Please verify your account before logging in");
    }

    const isPasswordValid = await verifyPassword(user.passwordHash, password);
    if (!isPasswordValid) throw new AppError(401, "Invalid credentials");

    const access = makeAccessTokenForUser(user.id, user.role!);
    const refresh = makeRefreshTokenForUser(user.id);
    setAuthCookies(res, access, refresh, "user");

    return sendSuccess(
      res,
      {
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
        },
      },
      200
    );
  } catch (err) {
    return handleError(res, err);
  }
};

export const logout = async (req: Request, res: Response) => {
  try {
    // Clear user cookies (fixed from previous vendor)
    clearAuthCookies(res, "user");

    return sendSuccess(res, { message: "Logged out" }, 200);
  } catch (err) {
    return handleError(res, err);
  }
};

/* ======================
   Password Reset
   ====================== */
export const forgottenPassword = async (req: Request, res: Response) => {
  try {
    const { email } = req.body || {};
    if (!isValidEmail(email))
      throw new AppError(400, "Valid email is required");

    await createAndSendOtp(email, "user", OtpType.PASSWORD_RESET);
    const resetToken = await createResetToken(email, "user");

    return sendSuccess(
      res,
      { message: "Password reset code sent to your email", resetToken },
      200
    );
  } catch (err) {
    return handleError(res, err);
  }
};

export const resetPassword = async (req: Request, res: Response) => {
  try {
    // Now expects a resetToken generated by processOtpVerification(..., purpose='reset')
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
      "user",
      resetToken
    );

    return sendSuccess(
      res,
      { message: "Password reset successfully. You can now login." },
      200
    );
  } catch (err) {
    return handleError(res, err);
  }
};

/* ======================
   Token Refresh
   ====================== */
export const refreshToken = async (req: Request, res: Response) => {
  try {
    const raw = getRefreshTokenFromReq(req, "user");
    if (!raw) throw new AppError(401, "No refresh token");

    const payload: any = verifyJwt(raw);
    if (!payload?.sub) throw new AppError(401, "Invalid token payload");

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true },
    });
    if (!user) throw new AppError(401, "Invalid user");

    const access = makeAccessTokenForUser(user.id, user.role);
    const refresh = makeRefreshTokenForUser(user.id);
    setAuthCookies(res, access, refresh, "user");

    return sendSuccess(res, { accessToken: access }, 200);
  } catch (err) {
    return handleError(res, err);
  }
};

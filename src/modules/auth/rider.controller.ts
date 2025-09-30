import {
  clearAuthCookies,
  getRefreshTokenFromReq,
  setAuthCookies,
} from "@config/cookies";
import prisma from "@config/db";
import {
  makeAccessTokenForRider,
  makeRefreshTokenForRider,
  verifyJwt,
} from "@config/jwt";
import { hashPassword, verifyPassword } from "@lib/hash";
import { AppError, handleError, sendSuccess } from "@lib/utils/AppError";
import {
  checkExistingEntity,
  createAndSendOtp,
  handlePasswordReset,
  isValidEmail,
  isValidNigerianPhone,
  processOtpVerification,
  updateEntityPassword,
  validatePassword,
} from "@modules/auth/helper";
import { Request, Response } from "express";
import { OtpType } from "../../generated/prisma";
import { getCustomerIdFromRequest } from "@modules/order/utils";
import { createResetToken } from '@config/redis';

/* =========================
   Rider Registration
   ========================= */
export const createRider = async (req: Request, res: Response) => {
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

    // Check if rider exists
    const registrationResult = await checkExistingEntity(
      email,
      phoneNumber,
      "rider"
    );

    if (!registrationResult.shouldCreateNew) {
      return sendSuccess(
        res,
        {
          message: registrationResult.message,
          riderId: registrationResult.entityId,
        },
        200
      );
    }

    // Create new rider
    const passwordHash = await hashPassword(password);
    const newRider = await prisma.rider.create({
      data: {
        fullName: fullName.trim(),
        email: email.trim(),
        phoneNumber: phoneNumber.trim(),
        passwordHash,
        vehicleType: req.body.vehicleType, // Make sure to validate and provide this field
      },
    });

    // Send OTP
    await createAndSendOtp(newRider.email, "rider", OtpType.EMAIL_VERIFICATION);

    return sendSuccess(
      res,
      { message: "Rider created. OTP sent to email.", riderId: newRider.id },
      201
    );
  } catch (err) {
    return handleError(res, err);
  }
};

/* =========================
   OTP: request & verify (rider)
   ========================= */
export const createRiderOtp = async (req: Request, res: Response) => {
  try {
    const { email } = req.body || {};
    if (!isValidEmail(email)) throw new AppError(400, "Valid email required");

    await createAndSendOtp(email, "rider", OtpType.EMAIL_VERIFICATION);
    return sendSuccess(
      res,
      { message: "Verification code sent to rider email" },
      200
    );
  } catch (err) {
    return handleError(res, err);
  }
};

export const verifyRiderOtp = async (req: Request, res: Response) => {
  try {
    const { email, otp, purpose } = req.body || {};
    if (!isValidEmail(email)) throw new AppError(400, "Valid email required");

    const result = await processOtpVerification(
      email,
      otp,
      "rider",
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
      // Login the rider after successful verification
      const access = makeAccessTokenForRider(result.entity.id);
      const refresh = makeRefreshTokenForRider(result.entity.id);
      setAuthCookies(res, access, refresh, "rider");

      return sendSuccess(
        res,
        { message: "Rider verified and logged in", riderId: result.entity.id },
        200
      );
    }
  } catch (err) {
    return handleError(res, err);
  }
};

/* =========================
   Rider Login
   ========================= */
export const loginRider = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body || {};

    if (!isValidEmail(email)) throw new AppError(400, "Valid email required");
    if (!password.trim()) throw new AppError(400, "Password is required");

    const rider = await prisma.rider.findUnique({ where: { email } });
    if (!rider) throw new AppError(400, "Invalid credentials");

    const passwordValid = await verifyPassword(password, rider.passwordHash);
    if (!passwordValid) throw new AppError(400, "Invalid credentials");

    // if (!rider.isVerified) {
    //   // If not verified, send OTP for verification
    //   await createAndSendOtp(rider.email, "rider", OtpType.EMAIL_VERIFICATION);
    //   return sendSuccess(
    //     res,
    //     {
    //       message:
    //         "Account not verified. OTP sent to your email for verification.",
    //       riderId: rider.id,
    //     },
    //     200
    //   );
    // }

    const access = makeAccessTokenForRider(rider.id);
    const refresh = makeRefreshTokenForRider(rider.id);
    setAuthCookies(res, access, refresh, "rider");

    return sendSuccess(
      res,
      { message: "Login successful", riderId: rider.id },
      200
    );
  } catch (err) {
    return handleError(res, err);
  }
};

/* =========================
   Rider Logout
   ========================= */
export const logoutRider = async (req: Request, res: Response) => {
  try {
    clearAuthCookies(res, "rider");
    return sendSuccess(res, { message: "Logout successful" }, 200);
  } catch (err) {
    return handleError(res, err);
  }
};

/* =========================
   Rider Refresh Token
   ========================= */
export const refreshRiderToken = async (req: Request, res: Response) => {
  try {
    const refreshToken = getRefreshTokenFromReq(req, "rider");
    if (!refreshToken) {
      throw new AppError(401, "Refresh token not found. Please log in.");
    }

    const decoded = verifyJwt(refreshToken) as { id: string };
    if (!decoded || !decoded.id) {
      throw new AppError(401, "Invalid refresh token. Please log in.");
    }

    const rider = await prisma.rider.findUnique({ where: { id: decoded.id } });
    if (!rider) {
      throw new AppError(401, "Rider not found. Please log in.");
    }

    const newAccessToken = makeAccessTokenForRider(rider.id);
    const newRefreshToken = makeRefreshTokenForRider(rider.id);
    setAuthCookies(res, newAccessToken, newRefreshToken, "rider");

    return sendSuccess(res, { message: "Token refreshed successfully" }, 200);
  } catch (err) {
    clearAuthCookies(res, "rider"); // Clear cookies on refresh failure
    return handleError(res, err);
  }
};

/* =========================
   Rider Forgot Password
   ========================= */
export const forgotRiderPassword = async (req: Request, res: Response) => {
  try {
    const { email } = req.body || {};
    if (!isValidEmail(email)) throw new AppError(400, "Valid email required");

    await createAndSendOtp(email, "rider", OtpType.PASSWORD_RESET);
    const resetToken = await createResetToken(email, "rider");
    return sendSuccess(
      res,
      { message: "Password reset code sent to your email", resetToken },
      200
    );
  } catch (err) {
    return handleError(res, err);
  }
};

/* =========================
   Rider Reset Password
   ========================= */
export const resetRiderPassword = async (req: Request, res: Response) => {
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
      "rider",
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

/* =========================
   Rider Change Password (Logged in)
   ========================= */
export const changeRiderPassword = async (req: Request, res: Response) => {
  try {
    const { oldPassword, newPassword } = req.body || {};
    const riderId = req.rider?.id; // Assuming rider ID is available from auth middleware
    getCustomerIdFromRequest;

    if (!riderId) {
      throw new AppError(401, "Unauthorized: Rider ID not found.");
    }

    validatePassword(newPassword);

    const rider = await prisma.rider.findUnique({ where: { id: riderId } });
    if (!rider) {
      throw new AppError(404, "Rider not found.");
    }

    const passwordValid = await verifyPassword(oldPassword, rider.passwordHash);
    if (!passwordValid) {
      throw new AppError(400, "Incorrect old password.");
    }

    await updateEntityPassword(riderId, newPassword, "rider");

    return sendSuccess(res, { message: "Password changed successfully." }, 200);
  } catch (err) {
    return handleError(res, err);
  }
};

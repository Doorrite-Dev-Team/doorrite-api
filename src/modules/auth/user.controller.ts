// src/controllers/auth.ts
import {
  clearAuthCookies,
  getRefreshTokenFromReq,
  setAuthCookies,
  setAccessCookies,
} from "@config/cookies";
import prisma from "@config/db";
import {
  makeAccessTokenForUser,
  makeRefreshTokenForUser,
  verifyJwt,
  type JwtPayloadShape,
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
import { createResetToken, getLoginAttemptsKey, redis } from "@config/redis";
import { socketService } from "@config/socket";
// import { AppSocketEvent } from "../../constants/socket";

export const createUser = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Auth']
   * #swagger.summary = 'Create a new user'
   * #swagger.description = 'Register a new user account'
   * #swagger.operationId = 'createUser'
   * #swagger.parameters['body'] = { in: 'body', description: 'User registration data', required: true, schema: { type: 'object', required: ['fullName', 'email', 'phoneNumber', 'password'], properties: { fullName: { type: 'string' }, email: { type: 'string' }, phoneNumber: { type: 'string' }, password: { type: 'string' } } } }
   * #swagger.responses[201] = { description: 'User created successfully', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } } }
    * #swagger.responses[400] = { description: 'Validation error', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } } }
    * #swagger.responses[409] = { description: 'User already exists', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } } }
    * #swagger.responses[500] = { description: 'Internal server error', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } } }
    */
  try {
    const { fullName, email, phoneNumber, password, referrerCode } = req.body || {};

    // Validate input
    if (
      !fullName ||
      typeof fullName !== "string" ||
      fullName.trim().length < 2
    ) {
      throw new AppError(
        400,
        "fullName is required and must be at least 2 characters",
      );
    }
    if (!isValidEmail(email)) throw new AppError(400, "Invalid email address");
    if (!isValidNigerianPhone(phoneNumber))
      throw new AppError(400, "Invalid Nigerian phone number");
    validatePassword(password);

    // Check if user exists
    const registrationResult = await checkExistingEntity(email, "user");

    if (!registrationResult.shouldCreateNew) {
      return sendSuccess(
        res,
        {
          message: registrationResult.message,
          userId: registrationResult.entityId,
        },
        409,
      );
    }

    // Handle referral
    let referredBy = null;
    if (referrerCode) {
      const referrer = await prisma.user.findUnique({
        where: { referralCode: referrerCode },
        select: { id: true },
      });
      if (referrer) {
        referredBy = referrer.id;
      }
    }

    // Create new user
    const passwordHash = await hashPassword(password);
    const newUser = await prisma.user.create({
      data: {
        fullName: fullName.trim(),
        email: email.trim(),
        phoneNumber: phoneNumber.trim(),
        passwordHash,
        referralCode: `DR-${phoneNumber.replace(/\D/g, "").slice(-6)}`,
        referredBy,
        freeDeliveryOrders: 2,
      },
    });

    if (referredBy) {
      await prisma.referral.create({
        data: {
          referrerId: referredBy,
          refereeId: newUser.id,
          refereePhone: phoneNumber.trim(),
          status: "pending",
        },
      });
    }

    // Send OTP (Redis-backed)
    await createAndSendOtp(newUser.email, "user", OtpType.EMAIL_VERIFICATION);

    return sendSuccess(
      res,
      { message: "User created. OTP sent to email.", userId: newUser.id },
      201,
    );
  } catch (err) {
    return handleError(res, err);
  }
};

export const createOtp = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Auth']
   * #swagger.summary = 'Create OTP'
   * #swagger.description = 'Send a one-time password to the user'
   * #swagger.operationId = 'createOtp'
   */
  try {
    const { email } = req.body || {};
    if (!isValidEmail(email)) throw new AppError(400, "Valid email required");

    await createAndSendOtp(email, "user", OtpType.EMAIL_VERIFICATION);
    return sendSuccess(
      res,
      { message: "Verification code sent to your email" },
      200,
    );
  } catch (err) {
    return handleError(res, err);
  }
};

export const verifyOtp = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Auth']
   * #swagger.summary = 'Verify OTP'
   * #swagger.description = 'Verify the one-time password'
   * #swagger.operationId = 'verifyOtp'
   */
  try {
    const { email, otp, purpose } = req.body || {};
    if (!isValidEmail(email)) throw new AppError(400, "Valid email required");

    const result = await processOtpVerification(
      email,
      otp,
      "user",
      purpose === "reset" ? "reset" : "verify",
    );

    if (purpose === "reset") {
      // returns resetToken when purpose === 'reset'
      return sendSuccess(
        res,
        {
          message: "OTP verified for Password reset",
          resetToken: result.resetToken,
        },
        200,
      );
    } else {
      // Login the user after successful verification
      const access = makeAccessTokenForUser(
        result.entity.id,
        result.entity.role,
      );
      const refresh = makeRefreshTokenForUser(result.entity.id);
      setAuthCookies(res, access, refresh, "user");

      return sendSuccess(res, { message: "OTP verified and logged in" }, 200);
    }
  } catch (err) {
    return handleError(res, err);
  }
};

export const login = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Auth']
   * #swagger.summary = 'User login'
   * #swagger.description = 'Authenticate and receive a JWT'
   * #swagger.operationId = 'login'
   * #swagger.parameters['body'] = { in: 'body', description: 'Login credentials', required: true, schema: { type: 'object', required: ['identifier', 'password'], properties: { identifier: { type: 'string' }, password: { type: 'string' } } } }
   * #swagger.responses[200] = { description: 'Login successful', schema: { type: 'object', properties: { ok: { type: 'boolean' }, accessToken: { type: 'string' }, refreshToken: { type: 'string' } } } }
   * #swagger.responses[401] = { description: 'Invalid credentials', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } } }
   * #swagger.responses[403] = { description: 'Account not verified', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } } }
   * #swagger.responses[500] = { description: 'Internal server error', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } } }
   */
  try {
    const { identifier, password } = req.body || {};

    const attemptsKey = getLoginAttemptsKey(identifier);
    const attempts = await redis.get(attemptsKey);
    if (attempts && parseInt(String(attempts), 10) >= 5) {
      throw new AppError(403, "Account locked due to too many failed attempts. Please try again in 15 minutes");
    }

    const user = await findEntityByIdentifier(identifier, "user");
    if (!user) {
      await redis.incr(attemptsKey);
      await redis.expire(attemptsKey, 15 * 60);
      throw new AppError(401, "Invalid credentials");
    }

    if (!user.isVerified) {
      throw new AppError(403, "Please verify your account before logging in");
    }

    const isPasswordValid = await verifyPassword(password, user.passwordHash);
    if (!isPasswordValid) {
      await redis.incr(attemptsKey);
      await redis.expire(attemptsKey, 15 * 60);
      throw new AppError(401, "Invalid credentials");
    }

    await redis.del(attemptsKey);

    const access = makeAccessTokenForUser(user.id, user.role!);
    const refresh = makeRefreshTokenForUser(user.id);
    setAuthCookies(res, access, refresh, "user");

    socketService.logIn(user.id, user.fullName!);

    return sendSuccess(
      res,
      {
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
          address: user.address,
        },
        access,
      },
      200,
    );
  } catch (err) {
    return handleError(res, err);
  }
};


export const logout = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Auth']
   * #swagger.summary = 'User logout'
   * #swagger.description = 'Log out the currently authenticated user'
   * #swagger.operationId = 'logout'
   */
  try {
    // Clear user cookies (fixed from previous vendor)
    clearAuthCookies(res, "user");

    return sendSuccess(res, { message: "Logged out" }, 200);
  } catch (err) {
    return handleError(res, err);
  }
};

export const forgottenPassword = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Auth']
   * #swagger.summary = 'Forgot password'
   * #swagger.description = 'Initiate the password reset process'
   * #swagger.operationId = 'forgottenPassword'
   * #swagger.parameters['body'] = { in: 'body', description: 'Email address', required: true, schema: { type: 'object', required: ['email'], properties: { email: { type: 'string' } } } }
   * #swagger.responses[200] = { description: 'Reset code sent', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } } }
    * #swagger.responses[400] = { description: 'Invalid email', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } } }
    * #swagger.responses[500] = { description: 'Internal server error', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } } }
    */
  try {
    const { email } = req.body || {};
    if (!isValidEmail(email))
      throw new AppError(400, "Valid email is required");

    await createAndSendOtp(email, "user", OtpType.PASSWORD_RESET);
    const resetToken = await createResetToken(email, "user");

    return sendSuccess(
      res,
      { message: "Password reset code sent to your email", resetToken },
      200,
    );
  } catch (err) {
    return handleError(res, err);
  }
};

export const resetPassword = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Auth']
   * #swagger.summary = 'Reset password'
   * #swagger.description = 'Reset the user password with a valid token'
   * #swagger.operationId = 'resetPassword'
   * #swagger.parameters['body'] = { in: 'body', description: 'Reset password data', required: true, schema: { type: 'object', required: ['email', 'password', 'confirmPassword', 'resetToken'], properties: { email: { type: 'string' }, password: { type: 'string' }, confirmPassword: { type: 'string' }, resetToken: { type: 'string' } } } }
   * #swagger.responses[200] = { description: 'Password reset successful', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } } }
    * #swagger.responses[400] = { description: 'Invalid request', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } } }
    * #swagger.responses[500] = { description: 'Internal server error', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } } }
    */
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
    await handlePasswordReset(email, passwordHash, passwordHash, "user", {
      resetToken,
    });

    return sendSuccess(
      res,
      { message: "Password reset successfully. You can now login." },
      200,
    );
  } catch (err) {
    return handleError(res, err);
  }
};

export const refreshToken = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Auth']
   * #swagger.summary = 'Refresh token'
   * #swagger.description = 'Obtain a new JWT using a refresh token'
   * #swagger.operationId = 'refreshToken'
   * #swagger.parameters['body'] = { in: 'body', description: 'Refresh token', required: false, schema: { type: 'object', properties: { refresh: { type: 'string' } } } }
   * #swagger.responses[200] = { description: 'Token refreshed successfully', schema: { type: 'object', properties: { ok: { type: 'boolean' }, accessToken: { type: 'string' }, refreshToken: { type: 'string' } } } }
    * #swagger.responses[401] = { description: 'Invalid or expired token', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } } }
    * #swagger.responses[500] = { description: 'Internal server error', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } } }
    */
  try {
    const raw = getRefreshTokenFromReq(req, "user");
    const { refresh } = req.body || {};
    if (!raw && !refresh) throw new AppError(401, "No refresh token");
    
    const token = raw || refresh;
    const payload = verifyJwt<JwtPayloadShape>(token);
    
    if (!payload?.sub) throw new AppError(401, "Invalid token payload");
    if (payload.type !== "refresh") throw new AppError(401, "Invalid token type");

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true },
    });
    if (!user) throw new AppError(401, "Invalid user");

    const access = makeAccessTokenForUser(user.id, "user");
    const newRefresh = makeRefreshTokenForUser(user.id);
    
    setAuthCookies(res, access, newRefresh, "user");

    return sendSuccess(res, { access }, 200);
  } catch (err) {
    return handleError(res, err);
  }
};

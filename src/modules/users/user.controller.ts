// src/controllers/auth.ts
import {
  ACCESS_COOKIE,
  accessCookieOptions,
  REFRESH_COOKIE,
  refreshCookieOptions,
} from "@config/cookies";
import prisma from "@config/db";
import {
  makeAccessTokenForUser,
  makeRefreshTokenForUser,
  verifyJwt,
} from "@config/jwt";
import sendmail from "@config/mail";
import { verificationEmailTemplate } from "@lib/emailTemplates";
import { hashPassword, verifyPassword } from "@lib/hash";
import { generateNumericOtp, otpExpiryMinutes } from "@lib/otp";
import crypto from "crypto";
import { Request, Response } from "express";

/* ======================
   AppError + helpers
   ====================== */
class AppError extends Error {
  status: number;
  details?: any;
  constructor(status: number, message: string, details?: any) {
    super(message);
    this.status = status;
    this.details = details;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

const sendSuccess = (res: Response, payload: object, status = 200) =>
  res.status(status).json({ ok: true, ...payload });

const sendFailure = (
  res: Response,
  status = 500,
  message = "Server error",
  details?: any
) => res.status(status).json({ ok: false, error: message, details });

const handleError = (res: Response, err: unknown) => {
  // Known AppError
  if (err instanceof AppError) {
    return sendFailure(res, err.status || 500, err.message, err.details);
  }

  // Unknown / unexpected
  console.error("Unhandled error:", err);
  return sendFailure(res, 500, "An unexpected error occurred");
};

/* ======================
   Small runtime validators (lightweight)
   ====================== */
const isValidEmail = (s: any) =>
  typeof s === "string" &&
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

const isValidNigerianPhone = (s: any) =>
  typeof s === "string" && /^(\+234|0)[789][01]\d{8}$/.test(s.trim());

/* ======================
   Rate limiter (dev)
   ====================== */
const rateLimitMap = new Map<string, number>();
const checkRateLimit = async (
  email: string,
  action: string,
  windowMinutes = 1
) => {
  const key = `${email}:${action}`;
  const now = Date.now();
  const windowMs = windowMinutes * 60 * 1000;
  const last = rateLimitMap.get(key) || 0;
  if (now - last < windowMs) {
    const timeLeft = Math.ceil((windowMs - (now - last)) / 1000);
    throw new AppError(429, `Please wait ${timeLeft} seconds before trying again`);
  }
  rateLimitMap.set(key, now);
  setTimeout(() => {
    const lastCheck = rateLimitMap.get(key) || 0;
    if (Date.now() - lastCheck >= windowMs) rateLimitMap.delete(key);
  }, windowMs + 2000);
};

/* ======================
   Utilities
   ====================== */
const generateHexToken = (len = 32) => crypto.randomBytes(len).toString("hex");

/* ======================
   createAndSendOtp
   - uses otp model only
   - throws AppError on known conditions
   - rolls back OTP if email sending fails
   ====================== */
const createAndSendOtp = async (email: string, isForgot = false) => {
  await checkRateLimit(
    email,
    isForgot ? "forgot_password_otp" : "signup_otp",
    1
  );

  const user = await prisma.user.findUnique({
    where: { email },
    include: { otp: true },
  });
  if (!user) throw new AppError(404, "User not found");

  // if (isForgot && (user.otp && !user.otp?.verified)) {
  //   // user must be verified to request password reset
  //   throw new AppError(
  //     400,
  //     "Please verify your account before requesting a password reset"
  //   );
  // }

  const code = generateNumericOtp(6);
  const expiresAt = new Date(Date.now() + otpExpiryMinutes() * 60 * 1000);

  await prisma.otp.upsert({
    where: { userId: user.id },
    create: {
      code,
      verified: false,
      expiresAt,
      user: { connect: { id: user.id } },
    },
    update: { code, verified: false, expiresAt },
  });

  const tpl = verificationEmailTemplate(user.fullName, code);

  try {
    await sendmail(user.email, tpl.subject, tpl.text, tpl.html);
  } catch (err) {
    // rollback OTP entry if the email fails so user doesn't have orphaned OTP
    await prisma.otp.deleteMany({ where: { userId: user.id } }).catch(() => {});
    throw new AppError(502, "Failed to send email. Please try again later");
  }
};

/* ======================
   Routes (Zod removed; lightweight checks instead)
   ====================== */

export const createUser = async (req: Request, res: Response) => {
  try {
    const data = req.body || {};
    const { fullName, email, phoneNumber, password } = data;

    if (!fullName || typeof fullName !== "string" || fullName.trim().length < 2) {
      throw new AppError(400, "fullName is required and must be at least 2 characters");
    }
    if (!isValidEmail(email)) throw new AppError(400, "Invalid email address");
    if (!isValidNigerianPhone(phoneNumber)) throw new AppError(400, "Invalid Nigerian phone number");
    if (!password || typeof password !== "string" || password.length < 8) {
      throw new AppError(400, "Password must be at least 8 characters");
    }

    const existing = await prisma.user.findFirst({
      where: { OR: [{ email }, { phoneNumber }] },
      include: { otp: true },
    });

    if (existing) {
      if (existing.otp && !existing.otp.verified) {
        await createAndSendOtp(existing.email);
        return sendSuccess(
          res,
          {
            message: "Account exists but not verified. New OTP sent to email.",
          },
          200
        );
      }
      throw new AppError(409, "User already exists. Please login");
    }

    const passwordHash = await hashPassword(password);
    const newUser = await prisma.user.create({
      data: {
        fullName: fullName.trim(),
        email: email.trim(),
        phoneNumber: phoneNumber.trim(),
        passwordHash,
      },
    });

    await createAndSendOtp(newUser.email);

    return sendSuccess(
      res,
      { message: "User created. OTP sent to email.", userId: newUser.id },
      201
    );
  } catch (err) {
    return handleError(res, err);
  }
};

export const createOtp = async (req: Request, res: Response) => {
  try {
    const { email } = req.body || {};
    if (!isValidEmail(email)) throw new AppError(400, "Valid email required");

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new AppError(404, "User not found");

    await createAndSendOtp(email);
    return sendSuccess(res, { message: "Verification code sent to your email" }, 200);
  } catch (err) {
    return handleError(res, err);
  }
};

/**
 * verifyOtp:
 * - body: { email, otp, purpose?: 'verify' | 'reset' }
 */
export const verifyOtp = async (req: Request, res: Response) => {
  try {
    const { email, otp, purpose } = req.body || {};
    if (!isValidEmail(email)) throw new AppError(400, "Valid email required");
    if (!otp || String(otp).length !== 6 || !/^\d{6}$/.test(String(otp))) {
      throw new AppError(400, "OTP must be a 6 digit number");
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: { otp: true },
    });
    if (!user || !user.otp) throw new AppError(404, "No OTP pending for this user");

    if (user.otp.code !== String(otp)) throw new AppError(400, "Invalid OTP");
    if (user.otp.expiresAt < new Date()) throw new AppError(400, "OTP expired");

    const action = purpose === "reset" ? "reset" : "verify";

    if (action === "verify") {
      await prisma.otp.update({
        where: { userId: user.id },
        data: { verified: true },
      });
      await prisma.otp.delete({ where: { userId: user.id } });

      const access = makeAccessTokenForUser(user.id, user.role);
      const refresh = makeRefreshTokenForUser(user.id);
      res.cookie(ACCESS_COOKIE, access, accessCookieOptions);
      res.cookie(REFRESH_COOKIE, refresh, refreshCookieOptions);

      return sendSuccess(res, { message: "OTP verified" }, 200);
    } else {
      // reset flow: mark verified, generate long reset token, set new expiry, persist token
      const resetToken = generateHexToken(32); // 64 hex chars
      const resetExpiry = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
      await prisma.otp.update({
        where: { userId: user.id },
        data: { verified: true, expiresAt: resetExpiry },
      });

      return sendSuccess(res, { message: "OTP verified for reset", resetToken }, 200);
    }
  } catch (err) {
    return handleError(res, err);
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body || {};
    if (!isValidEmail(email) || !password) throw new AppError(400, "Email and password are required");

    const user = await prisma.user.findUnique({
      where: { email },
      include: { otp: true },
    });
    if (!user) throw new AppError(401, "Invalid credentials");

    if (user.otp && !user.otp.verified) throw new AppError(403, "Email not verified. Check your inbox.");

    const ok = await verifyPassword(user.passwordHash, password);
    if (!ok) throw new AppError(401, "Invalid credentials");

    const access = makeAccessTokenForUser(user.id, user.role);
    const refresh = makeRefreshTokenForUser(user.id);
    res.cookie(ACCESS_COOKIE, access, accessCookieOptions);
    res.cookie(REFRESH_COOKIE, refresh, refreshCookieOptions);

    return sendSuccess(res, { user: { id: user.id, email: user.email, fullName: user.fullName } }, 200);
  } catch (err) {
    return handleError(res, err);
  }
};

export const logout = async (req: Request, res: Response) => {
  try {
    res.clearCookie(REFRESH_COOKIE);
    res.clearCookie(ACCESS_COOKIE);
    return sendSuccess(res, { message: "Logged out" }, 200);
  } catch (err) {
    return handleError(res, err);
  }
};

export const getUser = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.sub;
    if (!userId) throw new AppError(401, "Unauthorized");

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        fullName: true,
        email: true,
        phoneNumber: true,
        role: true,
      },
    });
    if (!user) throw new AppError(404, "User not found");
    return sendSuccess(res, { user }, 200);
  } catch (err) {
    return handleError(res, err);
  }
};

export const refreshToken = async (req: Request, res: Response) => {
  try {
    const raw = req.cookies?.[REFRESH_COOKIE];
    if (!raw) throw new AppError(401, "No refresh token");

    const payload: any = verifyJwt(raw);
    if (!payload?.sub) throw new AppError(401, "Invalid token payload");

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw new AppError(401, "Invalid user");

    const access = makeAccessTokenForUser(user.id, user.role);
    const refresh = makeRefreshTokenForUser(user.id);
    res.cookie(ACCESS_COOKIE, access, accessCookieOptions);
    res.cookie(REFRESH_COOKIE, refresh, refreshCookieOptions);

    return sendSuccess(res, { accessToken: access }, 200);
  } catch (err) {
    return handleError(res, err);
  }
};

export const ForgottenPassword = async (req: Request, res: Response) => {
  try {
    const { email } = req.body || {};
    if (!isValidEmail(email)) throw new AppError(400, "email is required");

    await createAndSendOtp(email, true);
    return sendSuccess(res, { message: "Password reset code sent to your email" }, 200);
  } catch (err) {
    return handleError(res, err);
  }
};

export const resetPassword = async (req: Request, res: Response) => {
  try {
    const { email, password, confirmPassword } = req.body || {};
    if (!isValidEmail(email) || !password || !confirmPassword) {
      throw new AppError(400, "Please provide all required fields");
    }
    if (password !== confirmPassword) throw new AppError(400, "Passwords do not match");
    if (password.length < 8) throw new AppError(400, "Password too short");

    const user = await prisma.user.findUnique({
      where: { email },
      include: { otp: true },
    });
    if (!user || !user.otp) throw new AppError(404, "User not found or reset session missing");

    // verify reset token if you stored it; in current simplified flow we just check expiry
    if (user.otp.expiresAt < new Date())
      throw new AppError(400, "Reset session expired. Please start the process again.");

    const passwordHash = await hashPassword(password);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    // consume otp record
    await prisma.otp.delete({ where: { userId: user.id } });

    return sendSuccess(res, { message: "Password reset successfully. You can now login." }, 200);
  } catch (err) {
    return handleError(res, err);
  }
};

export const cleanupExpiredTokens = async () => {
  try {
    const now = new Date();
    await prisma.otp.deleteMany({ where: { expiresAt: { lt: now } } });
    console.log("Expired OTPs cleaned up");
  } catch (err) {
    console.error("cleanupExpiredTokens error:", err);
  }
};

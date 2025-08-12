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
import { Request, Response } from "express";

export const createUser = async (req: Request, res: Response) => {
  try {
    const data = req.body;
    if (!data.fullName || !data.email || !data.phoneNumber || !data.password) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const existing = await prisma.user.findFirst({
      where: {
        OR: [{ email: data.email }, { phoneNumber: data.phoneNumber }],
      },
      include: { otp: true },
    });

    if (existing) {
      if (existing.otp && !existing.otp.verified) {
        const code = generateNumericOtp(6);
        const expiresAt = new Date(Date.now() + otpExpiryMinutes() * 60 * 1000);
        await prisma.otp.update({
          where: { userId: existing.id },
          data: { code, verified: false, expiresAt },
        });
        const tpl = verificationEmailTemplate(existing.fullName, code);
        await sendmail(
          existing.email,
          tpl.subject,
          tpl.text,
          tpl.html,
        );
        return res.status(200).json({ message: "OTP resent", otpSent: true });
      }
      return res
        .status(409)
        .json({ error: "User already exists. Please login." });
    }

    const passwordHash = await hashPassword(data.password);

    const newUser = await prisma.user.create({
      data: {
        fullName: data.fullName,
        email: data.email,
        phoneNumber: data.phoneNumber,
        passwordHash,
      },
    });

    const otpCode = generateNumericOtp(6);
    const expiresAt = new Date(Date.now() + otpExpiryMinutes() * 60 * 1000);
    await prisma.otp.create({
      data: {
        code: otpCode,
        verified: false,
        expiresAt,
        user: { connect: { id: newUser.id } },
      },
    });

    const tpl = verificationEmailTemplate(newUser.fullName, otpCode);
    await sendmail(  newUser.email,tpl.subject, tpl.text, tpl.html,);

    // set temporary token (optional)
    const tempToken = makeAccessTokenForUser(newUser.id, newUser.role);
    res.cookie(ACCESS_COOKIE, tempToken, accessCookieOptions);

    return res
      .status(201)
      .json({ message: "User created. OTP sent to email." });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: err.message || err });
  }
};

export const createOtp = async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "email required" });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(404).json({ error: "User not found" });

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
      update: {
        code,
        verified: false,
        expiresAt,
      },
    });

    const tpl = verificationEmailTemplate(user.fullName, code);
    await sendmail(user.email, tpl.subject, tpl.text, tpl.html);

    return res.status(200).json({ message: "OTP sent" });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: err.message || err });
  }
};

export const verifyOtp = async (req: Request, res: Response) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp)
      return res.status(400).json({ error: "email and otp required" });

    const user = await prisma.user.findUnique({
      where: { email },
      include: { otp: true },
    });
    if (!user || !user.otp)
      return res.status(404).json({ error: "No OTP pending for this user" });

    if (user.otp.code !== String(otp)) {
      return res.status(400).json({ error: "Invalid OTP" });
    }

    if (user.otp.expiresAt < new Date()) {
      return res.status(400).json({ error: "OTP expired" });
    }

    await prisma.otp.update({
      where: { userId: user.id },
      data: { verified: true },
    });

    // issue full tokens
    const access = makeAccessTokenForUser(user.id, user.role);
    const refresh = makeRefreshTokenForUser(user.id);

    res.cookie(ACCESS_COOKIE, access, accessCookieOptions);
    res.cookie(REFRESH_COOKIE, refresh, refreshCookieOptions);

    return res.status(200).json({ message: "OTP verified", ok: true });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: err.message || err });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({
      where: { email },
      include: { otp: true },
    });
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    // require email verified
    if (user.otp && !user.otp.verified) {
      return res
        .status(403)
        .json({ error: "Email not verified. Check your inbox." });
    }

    const ok = await verifyPassword(user.passwordHash, password);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    const access = makeAccessTokenForUser(user.id, user.role);
    const refresh = makeRefreshTokenForUser(user.id);

    res.cookie(ACCESS_COOKIE, access, accessCookieOptions);
    res.cookie(REFRESH_COOKIE, refresh, refreshCookieOptions);

    return res.json({
      ok: true,
      user: { id: user.id, email: user.email, fullName: user.fullName },
    });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: err.message || err });
  }
};

export const logout = async (req: Request, res: Response) => {
  try {
    res.clearCookie(REFRESH_COOKIE);
    res.clearCookie(ACCESS_COOKIE);
    return res.json({ ok: true });
  } catch (e) {
    console.error("logout error", e);
    return res.status(500).json({ error: "Logout failed" });
  }
};

export const getUser = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

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
    if (!user) return res.status(404).json({ error: "User not found" });
    return res.json(user);
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: err.message || err });
  }
};

export const refreshToken = async (req: Request, res: Response) => {
  try {
    const raw = req.cookies?.[REFRESH_COOKIE];
    if (!raw) return res.status(401).json({ error: "No refresh token" });

    const payload: any = verifyJwt(raw); // throws if invalid
    if (!payload?.sub)
      return res.status(401).json({ error: "Invalid token payload" });

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) return res.status(401).json({ error: "Invalid user" });

    // issue new access + refresh (stateless)
    const access = makeAccessTokenForUser(user.id, user.role);
    const refresh = makeRefreshTokenForUser(user.id);

    res.cookie(ACCESS_COOKIE, access, accessCookieOptions);
    res.cookie(REFRESH_COOKIE, refresh, refreshCookieOptions);

    return res.json({ ok: true, accessToken: access });
  } catch (err: any) {
    console.error("refreshToken error", err);
    return res.status(401).json({ error: "Invalid or expired refresh token" });
  }
};

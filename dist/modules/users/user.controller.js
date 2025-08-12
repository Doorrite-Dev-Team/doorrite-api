"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.refreshToken = exports.getUser = exports.logout = exports.login = exports.verifyOtp = exports.createOtp = exports.createUser = void 0;
// src/controllers/auth.ts
const cookies_1 = require("@config/cookies");
const db_1 = __importDefault(require("@config/db"));
const jwt_1 = require("@config/jwt");
const mail_1 = __importDefault(require("@config/mail"));
const emailTemplates_1 = require("@lib/emailTemplates");
const hash_1 = require("@lib/hash");
const otp_1 = require("@lib/otp");
const createUser = async (req, res) => {
    try {
        const data = req.body;
        if (!data.fullName || !data.email || !data.phoneNumber || !data.password) {
            return res.status(400).json({ error: "Missing required fields" });
        }
        const existing = await db_1.default.user.findFirst({
            where: {
                OR: [{ email: data.email }, { phoneNumber: data.phoneNumber }],
            },
            include: { otp: true },
        });
        if (existing) {
            if (existing.otp && !existing.otp.verified) {
                const code = (0, otp_1.generateNumericOtp)(6);
                const expiresAt = new Date(Date.now() + (0, otp_1.otpExpiryMinutes)() * 60 * 1000);
                await db_1.default.otp.update({
                    where: { userId: existing.id },
                    data: { code, verified: false, expiresAt },
                });
                const tpl = (0, emailTemplates_1.verificationEmailTemplate)(existing.fullName, code);
                await (0, mail_1.default)(existing.email, tpl.subject, tpl.text, tpl.html);
                return res.status(200).json({ message: "OTP resent", otpSent: true });
            }
            return res
                .status(409)
                .json({ error: "User already exists. Please login." });
        }
        const passwordHash = await (0, hash_1.hashPassword)(data.password);
        const newUser = await db_1.default.user.create({
            data: {
                fullName: data.fullName,
                email: data.email,
                phoneNumber: data.phoneNumber,
                passwordHash,
            },
        });
        const otpCode = (0, otp_1.generateNumericOtp)(6);
        const expiresAt = new Date(Date.now() + (0, otp_1.otpExpiryMinutes)() * 60 * 1000);
        await db_1.default.otp.create({
            data: {
                code: otpCode,
                verified: false,
                expiresAt,
                user: { connect: { id: newUser.id } },
            },
        });
        const tpl = (0, emailTemplates_1.verificationEmailTemplate)(newUser.fullName, otpCode);
        await (0, mail_1.default)(newUser.email, tpl.subject, tpl.text, tpl.html);
        // set temporary token (optional)
        const tempToken = (0, jwt_1.makeAccessTokenForUser)(newUser.id, newUser.role);
        res.cookie(cookies_1.ACCESS_COOKIE, tempToken, cookies_1.accessCookieOptions);
        return res
            .status(201)
            .json({ message: "User created. OTP sent to email." });
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ error: err.message || err });
    }
};
exports.createUser = createUser;
const createOtp = async (req, res) => {
    try {
        const { email } = req.body;
        if (!email)
            return res.status(400).json({ error: "email required" });
        const user = await db_1.default.user.findUnique({ where: { email } });
        if (!user)
            return res.status(404).json({ error: "User not found" });
        const code = (0, otp_1.generateNumericOtp)(6);
        const expiresAt = new Date(Date.now() + (0, otp_1.otpExpiryMinutes)() * 60 * 1000);
        await db_1.default.otp.upsert({
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
        const tpl = (0, emailTemplates_1.verificationEmailTemplate)(user.fullName, code);
        await (0, mail_1.default)(user.email, tpl.subject, tpl.text, tpl.html);
        return res.status(200).json({ message: "OTP sent" });
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ error: err.message || err });
    }
};
exports.createOtp = createOtp;
const verifyOtp = async (req, res) => {
    try {
        const { email, otp } = req.body;
        if (!email || !otp)
            return res.status(400).json({ error: "email and otp required" });
        const user = await db_1.default.user.findUnique({
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
        await db_1.default.otp.update({
            where: { userId: user.id },
            data: { verified: true },
        });
        // issue full tokens
        const access = (0, jwt_1.makeAccessTokenForUser)(user.id, user.role);
        const refresh = (0, jwt_1.makeRefreshTokenForUser)(user.id);
        res.cookie(cookies_1.ACCESS_COOKIE, access, cookies_1.accessCookieOptions);
        res.cookie(cookies_1.REFRESH_COOKIE, refresh, cookies_1.refreshCookieOptions);
        return res.status(200).json({ message: "OTP verified", ok: true });
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ error: err.message || err });
    }
};
exports.verifyOtp = verifyOtp;
const login = async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await db_1.default.user.findUnique({
            where: { email },
            include: { otp: true },
        });
        if (!user)
            return res.status(401).json({ error: "Invalid credentials" });
        // require email verified
        if (user.otp && !user.otp.verified) {
            return res
                .status(403)
                .json({ error: "Email not verified. Check your inbox." });
        }
        const ok = await (0, hash_1.verifyPassword)(user.passwordHash, password);
        if (!ok)
            return res.status(401).json({ error: "Invalid credentials" });
        const access = (0, jwt_1.makeAccessTokenForUser)(user.id, user.role);
        const refresh = (0, jwt_1.makeRefreshTokenForUser)(user.id);
        res.cookie(cookies_1.ACCESS_COOKIE, access, cookies_1.accessCookieOptions);
        res.cookie(cookies_1.REFRESH_COOKIE, refresh, cookies_1.refreshCookieOptions);
        return res.json({
            ok: true,
            user: { id: user.id, email: user.email, fullName: user.fullName },
        });
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ error: err.message || err });
    }
};
exports.login = login;
const logout = async (req, res) => {
    try {
        res.clearCookie(cookies_1.REFRESH_COOKIE);
        res.clearCookie(cookies_1.ACCESS_COOKIE);
        return res.json({ ok: true });
    }
    catch (e) {
        console.error("logout error", e);
        return res.status(500).json({ error: "Logout failed" });
    }
};
exports.logout = logout;
const getUser = async (req, res) => {
    try {
        const userId = req.user?.sub;
        if (!userId)
            return res.status(401).json({ error: "Unauthorized" });
        const user = await db_1.default.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                fullName: true,
                email: true,
                phoneNumber: true,
                role: true,
            },
        });
        if (!user)
            return res.status(404).json({ error: "User not found" });
        return res.json(user);
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ error: err.message || err });
    }
};
exports.getUser = getUser;
const refreshToken = async (req, res) => {
    try {
        const raw = req.cookies?.[cookies_1.REFRESH_COOKIE];
        if (!raw)
            return res.status(401).json({ error: "No refresh token" });
        const payload = (0, jwt_1.verifyJwt)(raw); // throws if invalid
        if (!payload?.sub)
            return res.status(401).json({ error: "Invalid token payload" });
        const user = await db_1.default.user.findUnique({ where: { id: payload.sub } });
        if (!user)
            return res.status(401).json({ error: "Invalid user" });
        // issue new access + refresh (stateless)
        const access = (0, jwt_1.makeAccessTokenForUser)(user.id, user.role);
        const refresh = (0, jwt_1.makeRefreshTokenForUser)(user.id);
        res.cookie(cookies_1.ACCESS_COOKIE, access, cookies_1.accessCookieOptions);
        res.cookie(cookies_1.REFRESH_COOKIE, refresh, cookies_1.refreshCookieOptions);
        return res.json({ ok: true, accessToken: access });
    }
    catch (err) {
        console.error("refreshToken error", err);
        return res.status(401).json({ error: "Invalid or expired refresh token" });
    }
};
exports.refreshToken = refreshToken;

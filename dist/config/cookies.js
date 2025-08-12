"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.refreshCookieOptions = exports.accessCookieOptions = exports.REFRESH_COOKIE = exports.ACCESS_COOKIE = exports.cookieOptions = void 0;
// src/config/cookies.ts
exports.cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
};
exports.ACCESS_COOKIE = "access_token";
exports.REFRESH_COOKIE = "refresh_token";
exports.accessCookieOptions = {
    ...exports.cookieOptions,
    maxAge: 15 * 60 * 1000, // 15 minutes
};
exports.refreshCookieOptions = {
    ...exports.cookieOptions,
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
};

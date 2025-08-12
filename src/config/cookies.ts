// src/config/cookies.ts
export const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as "lax" | "strict" | "none",
  path: "/",
};

export const ACCESS_COOKIE = "access_token";
export const REFRESH_COOKIE = "refresh_token";

export const accessCookieOptions = {
  ...cookieOptions,
  maxAge: 15 * 60 * 1000, // 15 minutes
};

export const refreshCookieOptions = {
  ...cookieOptions,
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
};

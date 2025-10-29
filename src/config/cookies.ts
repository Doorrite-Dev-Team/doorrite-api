// src/config/cookies.ts
import { Request, Response } from "express";

/**
 * Cookie base options
 */
export const cookieOptions = {
  httpOnly: true,
  // secure cookies in production (required for SameSite=None)
  secure: process.env.NODE_ENV === "production",
  // In production we need cross-site cookies (frontend on Netlify, API on Render)
  // so use 'none' in production and 'lax' in development for safety.
  sameSite: (process.env.NODE_ENV === "production" ? "none" : "lax") as
    | "lax"
    | "strict"
    | "none",
  path: "/",
};

/**
 * Default names (legacy / backward compatibility - point to 'user' cookies)
 */
export const ACCESS_COOKIE = "access_token_user";
export const REFRESH_COOKIE = "refresh_token_user";

/**
 * Lifetimes (ms for cookie maxAge)
 */
export const ACCESS_MAX_AGE = 15 * 60 * 1000; // 15 minutes
export const REFRESH_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days

export const accessCookieOptions = {
  ...cookieOptions,
  maxAge: ACCESS_MAX_AGE,
};

export const refreshCookieOptions = {
  ...cookieOptions,
  maxAge: REFRESH_MAX_AGE,
};

/**
 * Supported entity/account types.
 * 'customer' (or common typo 'custumer') maps to 'user'.
 */
export type EntityType = "user" | "vendor" | "rider" | "admin";

/** Normalize alias/typo to canonical entity type */
export const normalizeEntityType = (t: string): EntityType => {
  const lowercase = String(t || "").toLowerCase();
  if (lowercase === "vendor") return "vendor";
  if (lowercase === "rider") return "rider";
  if (lowercase === "admin") return "admin";
  // treat customer/custumer as user
  return "user";
};

/** Cookie name helpers */
export const getAccessCookieName = (entity: EntityType) =>
  `access_token_${normalizeEntityType(entity)}`;

export const getRefreshCookieName = (entity: EntityType) =>
  `refresh_token_${normalizeEntityType(entity)}`;

/**
 * Set both auth cookies for a specific entity type.
 * Use this in controllers when issuing tokens.
 */
export const setAuthCookies = (
  res: Response,
  accessToken: string,
  refreshToken: string,
  entity: EntityType = "user"
) => {
  const e = normalizeEntityType(entity);
  res.cookie(getAccessCookieName(e), accessToken, accessCookieOptions);
  res.cookie(getRefreshCookieName(e), refreshToken, refreshCookieOptions);
};

/**
 * Clear both auth cookies for a specific entity type.
 */
export const clearAuthCookies = (
  res: Response,
  entity: EntityType = "user"
) => {
  const e = normalizeEntityType(entity);
  res.clearCookie(getAccessCookieName(e));
  res.clearCookie(getRefreshCookieName(e));
};

/**
 * Read the refresh token for a given entity from the request cookies.
 * Useful in refresh endpoints.
 */
export const getRefreshTokenFromReq = (
  req: Request,
  entity: EntityType = "user"
) => {
  const e = normalizeEntityType(entity);
  return req.cookies?.[getRefreshCookieName(e)];
};

/**
 * Read the access token for given entity from the request cookies.
 */
export const getAccessTokenFromReq = (
  req: Request,
  entity: EntityType = "user"
) => {
  const e = normalizeEntityType(entity);
  return req.cookies?.[getAccessCookieName(e)];
};

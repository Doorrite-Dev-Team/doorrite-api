// File: src/config/jwt.ts
import Crypto from "crypto";
import * as jwt from "jsonwebtoken";

export const JWT_SECRET: jwt.Secret = (process.env.JWT_SECRET ||
  "change_me_here_for_prod") as jwt.Secret;

export const ACCESS_EXPIRES = process.env.ACCESS_EXPIRES || "15m";
export const REFRESH_EXPIRES = process.env.REFRESH_EXPIRES || "30d";
export const TEMP_EXPIRES = process.env.TEMP_EXPIRES || "15m";

export interface JwtPayloadShape {
  sub: string;
  role?: "user" | "vendor" | "rider" | "admin";
  type?: "temp" | "access" | "refresh";
  iat?: number;
  exp?: number;
}

export function createAccessToken(payload: object) {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: ACCESS_EXPIRES,
  } as jwt.SignOptions);
}

export function createRefreshToken(payload: object) {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: REFRESH_EXPIRES,
  } as jwt.SignOptions);
}

export function signJwt(payload: object) {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: TEMP_EXPIRES,
  } as jwt.SignOptions);
}

export function verifyJwt<T = any>(token: string): T {
  // Throwing behavior — callers should catch
  return jwt.verify(token, JWT_SECRET) as T;
}

export function generateOpaqueToken(len = 48) {
  return Crypto.randomBytes(len).toString("hex");
}

export function makeAccessTokenForUser(userId: string, role?: string) {
  return createAccessToken({ sub: userId, role, type: "access" });
}

// --------------------
// User/Custumer token helpers
// --------------------
// User/Custumers are separate entities in the DB. We provide convenience helpers
// for creating User/Custumer-scoped tokens. We include a `role` field set to
// "User/Custumer" to make server-side authorization checks straightforward.

export function makeRefreshTokenForUser(userId: string) {
  return createRefreshToken({ sub: userId, type: "refresh" });
}

// --------------------
// Vendor token helpers
// --------------------
// Vendors are separate entities in the DB. We provide convenience helpers
// for creating vendor-scoped tokens. We include a `role` field set to
// "vendor" to make server-side authorization checks straightforward.

export function makeAccessTokenForVendor(vendorId: string) {
  return createAccessToken({ sub: vendorId, role: "vendor", type: "access" });
}

export function makeRefreshTokenForVendor(vendorId: string) {
  return createRefreshToken({ sub: vendorId, role: "vendor", type: "refresh" });
}

// --------------------
// Rider token helpers
// --------------------
// Riders are separate entities in the DB. We provide convenience helpers
// for creating Rider-scoped tokens. We include a `role` field set to
// "Rider" to make server-side authorization checks straightforward.

export function makeAccessTokenForRider(riderId: string) {
  return createAccessToken({ sub: riderId, role: "rider", type: "access" });
}
export function makeRefreshTokenForRider(riderId: string) {
  return createRefreshToken({ sub: riderId, role: "rider", type: "refresh" });
}

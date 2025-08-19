// src/middleware/requireAuth.ts
import {
  getAccessTokenFromReq,
  getRefreshTokenFromReq,
  normalizeEntityType,
  setAuthCookies,
} from "@config/cookies";
import prisma from "@config/db";
import {
  createAccessToken,
  createRefreshToken,
  JwtPayloadShape,
  verifyJwt,
} from "@config/jwt";
import { cleanupExpiredOTPs } from "@modules/auth/helper";
import { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * NOTE: We attach the payload to req.user.
 * Type augmentation is omitted for brevity—cast req as any when reading/writing req.user.
 */

/**
 * Middleware factory that requires an authenticated entity.
 * entity: 'user' | 'vendor' | 'rider' (aliases normalized)
 */
export function requireAuth(entity: string = "user"): RequestHandler {
  const canonical = normalizeEntityType(entity);

  return async function (req: Request, res: Response, next: NextFunction) {
    try {
      // 1) Try access token: Authorization header OR entity-specific access cookie
      const headerToken = req.headers.authorization?.split(" ")[1];
      const cookieAccess = getAccessTokenFromReq(req, canonical as any);
      const accessToken = headerToken || cookieAccess;

      if (accessToken) {
        const payload = safeVerify(accessToken);
        if (payload && payloadMatchesEntity(payload, canonical)) {
          // attach and continue
          (req as any).user = payload;
          await cleanupExpiredOTPs();
          return next();
        }
      }

      // 2) Access not present or invalid -> attempt refresh flow using entity-specific refresh cookie
      const refreshed = await attemptRefreshFlow(req, res, canonical);
      if (refreshed) {
        await cleanupExpiredOTPs();
        return next();
      }

      return res.status(401).json({ error: "Unauthorized" });
    } catch (err) {
      console.error("requireAuth error:", err);
      return res.status(401).json({ error: "Unauthorized" });
    }
  };
}

/**
 * attemptRefreshFlow - validates the refresh token for the requested entity,
 * ensures the entity still exists (and for vendor that it is active & verified),
 * issues new access & refresh tokens and sets the entity cookies.
 *
 * Returns true if succeeded and attached req.user, false otherwise.
 */
export async function attemptRefreshFlow(
  req: Request,
  res: Response,
  entity: string
): Promise<boolean> {
  try {
    const refreshToken = getRefreshTokenFromReq(req, entity as any);
    if (!refreshToken) return false;

    // verify refresh token
    let rpayload: JwtPayloadShape | null = null;
    try {
      rpayload = verifyJwt<JwtPayloadShape>(refreshToken);
    } catch {
      return false;
    }

    if (!rpayload?.sub) return false;

    // load corresponding entity from DB
    if (entity === "vendor") {
      const vendor = await prisma.vendor.findUnique({
        where: { id: rpayload.sub },
        select: { id: true, isVerified: true, isActive: true },
      });
      if (!vendor) return false;
      if (!vendor.isVerified) return false;
      if (!vendor.isActive) return false;

      // create new tokens
      const newAccess = createAccessToken({
        sub: vendor.id,
        role: "vendor",
        type: "access",
      });
      const newRefresh = createRefreshToken({
        sub: vendor.id,
        type: "refresh",
      });

      // set cookies for vendor
      setAuthCookies(res, newAccess, newRefresh, "vendor");

      // attach to request
      (req as any).user = verifyJwt<JwtPayloadShape>(newAccess);
      return true;
    }

    if (entity === "rider") {
      const rider = await prisma.rider.findUnique({
        where: { id: rpayload.sub },
        select: { id: true, isVerified: true },
      });
      if (!rider) return false;
      if (!rider.isVerified) return false;

      const newAccess = createAccessToken({
        sub: rider.id,
        role: "rider",
        type: "access",
      });
      const newRefresh = createRefreshToken({ sub: rider.id, type: "refresh" });

      setAuthCookies(res, newAccess, newRefresh, "rider");
      (req as any).user = verifyJwt<JwtPayloadShape>(newAccess);
      return true;
    }

    // default: user
    const user = await prisma.user.findUnique({
      where: { id: rpayload.sub },
      select: { id: true, role: true },
    });
    if (!user) return false;

    const newAccess = createAccessToken({
      sub: user.id,
      role: user.role,
      type: "access",
    });
    const newRefresh = createRefreshToken({ sub: user.id, type: "refresh" });

    setAuthCookies(res, newAccess, newRefresh, "user");
    (req as any).user = verifyJwt<JwtPayloadShape>(newAccess);
    return true;
  } catch (err) {
    console.error("attemptRefreshFlow error:", err);
    return false;
  }
}

/** verifyJwt wrapper that returns null on failure */
function safeVerify(token: string): JwtPayloadShape | null {
  try {
    return verifyJwt<JwtPayloadShape>(token);
  } catch {
    return null;
  }
}

/**
 * payloadMatchesEntity - protects against cross-entity tokens
 * e.g. user token shouldn't be accepted where vendor token is required.
 */
function payloadMatchesEntity(payload: JwtPayloadShape, entity: string) {
  if (!payload) return false;
  const role = String(payload.role || "").toLowerCase();
  if (entity === "vendor") {
    return role === "vendor";
  }
  if (entity === "rider") {
    return role === "rider";
  }
  // user accepts ADMIN or CUSTOMER or missing (backward compat)
  return role !== "vendor" && role !== "rider";
}

/**
 * Small admin guard (use after requireAuth('user') so req.user exists)
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const payload = (req as any).user as JwtPayloadShape | undefined;
    if (!payload || String(payload.role).toUpperCase() !== "ADMIN") {
      return res.status(403).json({ error: "Admin access required" });
    }
    return next();
  } catch (err) {
    return res.status(500).json({ error: "Server error" });
  }
}

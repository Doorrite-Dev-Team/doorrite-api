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
import { AppError } from "@lib/utils/AppError";
// import { cleanupExpiredOTPs } from "@modules/auth/helper";
import { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * NOTE: We attach the payload to req.user.
 * Type augmentation is omitted for brevity—cast req as any when reading/writing req.user.
 */

/**
 * Middleware factory that requires an authenticated entity.
 * entity: 'user' | 'vendor' | 'rider' (aliases normalized)
 */
export function requireAuth(userType: string = "user"): RequestHandler {
  const entity = userType === "customer" ? "user" : userType.toLowerCase();
  const canonical = normalizeEntityType(entity);

  return async function (req: Request, res: Response, next: NextFunction) {
    try {
      // 1) Try access token: Authorization header OR entity-specific access cookie
      const headerToken = req.headers.authorization?.split(" ")[1];
      const cookieAccess = getAccessTokenFromReq(req, canonical);
      const accessToken = headerToken || cookieAccess;

      if (accessToken) {
        const payload = safeVerify(accessToken);
        if (payload && payloadMatchesEntity(payload, canonical)) {
          // attach and continue
          req.user = payload;
          // await cleanupExpiredOTPs();
          return next();
        }
      }

      // 2) Access not present or invalid -> attempt refresh flow using entity-specific refresh cookie
      const refreshed = await attemptRefreshFlow(req, res, canonical);
      if (refreshed) {
        // await cleanupExpiredOTPs();
        return next();
      }

      return res.status(401).json({
        error:
          "Unauthorized, No Access Token and Unable to attempt refresh flow: Culprit",
      });
    } catch (err) {
      console.log("requireAuth error:", err);
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
      role: user.role === "CUSTOMER" ? "user" : "admin",
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
  if (entity === "admin") {
    return role === "admin";
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
    // console.log(payload, req.user);
    if (!payload || String(payload.role).toUpperCase() !== "ADMIN") {
      return res.status(403).json({ error: "Admin access required" });
    }
    return next();
  } catch (err) {
    return res.status(500).json({ error: "Server error" });
  }
}

// Extend Request type to include vendor
declare global {
  namespace Express {
    interface Request {
      vendor?: {
        id: string;
        email: string;
        businessName: string;
        isActive: boolean;
        isVerified: boolean;
      };
    }
  }
}

// Extract token from cookies or Authorization header
const getTokenFromRequest = (req: Request): string | null => {
  // Check Authorization header first
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.substring(7);
  }

  // Check cookies (adjust cookie name based on your implementation)
  const token = req.cookies?.vendor_access_token;
  return token || null;
};

export const authenticateVendor = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const token = getTokenFromRequest(req);

    if (!token) {
      throw new AppError(401, "Authentication required");
    }

    // Verify JWT token
    const payload: any = verifyJwt(token);
    if (!payload?.sub) {
      throw new AppError(401, "Invalid token");
    }

    // Get vendor from database
    const vendor = await prisma.vendor.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        businessName: true,
        isActive: true,
        isVerified: true,
      },
    });

    if (!vendor) {
      throw new AppError(401, "Vendor not found");
    }

    if (!vendor.isVerified) {
      throw new AppError(403, "Email verification required");
    }

    if (!vendor.isActive) {
      throw new AppError(403, "Account pending admin approval");
    }

    // Attach vendor to request
    req.vendor = vendor;
    next();
  } catch (error: any) {
    if (error instanceof AppError) {
      return res.status(error.status).json({
        ok: false,
        error: error.message,
      });
    }

    return res.status(401).json({
      ok: false,
      error: "Authentication failed",
    });
  }
};

// Optional: Middleware for optional vendor authentication (for public endpoints that can show more data if authenticated)
export const optionalVendorAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const token = getTokenFromRequest(req);

    if (!token) {
      return next(); // No token, continue without authentication
    }

    const payload: any = verifyJwt(token);
    if (!payload?.sub) {
      return next(); // Invalid token, continue without authentication
    }

    const vendor = await prisma.vendor.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        businessName: true,
        isActive: true,
        isVerified: true,
      },
    });

    if (vendor && vendor.isVerified && vendor.isActive) {
      req.vendor = vendor;
    }

    next();
  } catch {
    // Ignore errors and continue without authentication
    next();
  }
};

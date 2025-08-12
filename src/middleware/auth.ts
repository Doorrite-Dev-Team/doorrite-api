// src/middleware/requireAuth.ts
import {
  ACCESS_COOKIE,
  accessCookieOptions,
  REFRESH_COOKIE
} from "@config/cookies";
import prisma from "@config/db";
import { createAccessToken, JwtPayloadShape, verifyJwt } from "@config/jwt";
import { NextFunction, Request, Response } from "express";

// export async function requireAuth(
//   req: Request,
//   res: Response,
//   next: NextFunction
// ) {
//   try {
//     const authHeader = req.headers.authorization;
//     const token = authHeader?.split(" ")[1] ?? req.cookies?.[ACCESS_COOKIE];
//     if (!token) return res.status(401).json({ error: "No token" });

//     try {
//       const payload = verifyJwt<JwtPayloadShape>(token);
//       req.user = payload;
//       return next();
//     } catch (err: any) {
//       // token invalid or expired — try refresh (convenience)
//       const refresh = req.cookies?.[REFRESH_COOKIE];
//       if (!refresh)
//         return res
//           .status(401)
//           .json({ error: "Token expired; refresh required" });

//       try {
//         const rpayload = verifyJwt<JwtPayloadShape>(refresh);
//         if (!rpayload?.sub)
//           return res.status(401).json({ error: "Invalid refresh token" });

//         const user = await prisma.user.findUnique({
//           where: { id: rpayload.sub },
//         });
//         if (!user)
//           return res.status(401).json({ error: "Invalid refresh token user" });

//         // issue new access token
//         const newAccess = createAccessToken({
//           sub: rpayload.sub,
//           role: user.role,
//         });
//         res.cookie(ACCESS_COOKIE, newAccess, accessCookieOptions);

//         req.user = { sub: rpayload.sub, role: user.role };
//         return next();
//       } catch (e) {
//         return res.status(401).json({ error: "Refresh failed" });
//       }
//     }
//   } catch (e) {
//     console.error("requireAuth error", e);
//     return res.status(500).json({ error: "Server error" });
//   }
// }

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const token =
    req.headers.authorization?.split(" ")[1] || req.cookies?.[ACCESS_COOKIE];
  if (!token) return res.status(401).json({ error: "No token" });

  let payload = safeVerify(token);
  if (payload) {
    req.user = payload;
    return next();
  }

  // Fallback to refresh
  const newUser = await attemptRefreshFlow(req, res);
  if (newUser) return next();

  return res.status(401).json({ error: "Unauthorized" });
}

function safeVerify(token: string): JwtPayloadShape | null {
  try {
    return verifyJwt<JwtPayloadShape>(token);
  } catch {
    return null;
  }
}

async function attemptRefreshFlow(req: Request, res: Response): Promise<boolean> {
  const refresh = req.cookies?.[REFRESH_COOKIE];
  if (!refresh) return false;

  try {
    const payload = verifyJwt<JwtPayloadShape>(refresh);
    if (!payload.sub) return false;
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) return false;

    const newAccess = createAccessToken({ sub: payload.sub, role: user.role });
    res.cookie(ACCESS_COOKIE, newAccess, accessCookieOptions);
    req.user = payload; // or include role
    return true;
  } catch {
    return false;
  }
}
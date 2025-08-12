"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
// src/middleware/requireAuth.ts
const cookies_1 = require("@config/cookies");
const db_1 = __importDefault(require("@config/db"));
const jwt_1 = require("@config/jwt");
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
async function requireAuth(req, res, next) {
    const token = req.headers.authorization?.split(" ")[1] || req.cookies?.[cookies_1.ACCESS_COOKIE];
    if (!token)
        return res.status(401).json({ error: "No token" });
    let payload = safeVerify(token);
    if (payload) {
        req.user = payload;
        return next();
    }
    // Fallback to refresh
    const newUser = await attemptRefreshFlow(req, res);
    if (newUser)
        return next();
    return res.status(401).json({ error: "Unauthorized" });
}
function safeVerify(token) {
    try {
        return (0, jwt_1.verifyJwt)(token);
    }
    catch {
        return null;
    }
}
async function attemptRefreshFlow(req, res) {
    const refresh = req.cookies?.[cookies_1.REFRESH_COOKIE];
    if (!refresh)
        return false;
    try {
        const payload = (0, jwt_1.verifyJwt)(refresh);
        if (!payload.sub)
            return false;
        const user = await db_1.default.user.findUnique({ where: { id: payload.sub } });
        if (!user)
            return false;
        const newAccess = (0, jwt_1.createAccessToken)({ sub: payload.sub, role: user.role });
        res.cookie(cookies_1.ACCESS_COOKIE, newAccess, cookies_1.accessCookieOptions);
        req.user = payload; // or include role
        return true;
    }
    catch {
        return false;
    }
}

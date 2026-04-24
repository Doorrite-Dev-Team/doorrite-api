// import { Rider, Payment } from './generated/prisma/index.d';
import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { NextFunction, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import morgan from "morgan";
import swaggerUi from "swagger-ui-express";
const swaggerDocumet = require("./swagger-output.json");
// const prismaSchema = require("./json-schema.json");

// console.log("====================================");
// console.log(JSON.parse(JSON.stringify(prismaSchema) as any).definitions);
// console.log("====================================");
//routes
import AuthRoutes from "@modules/auth/routes";
import OrderRoutes from "@modules/order/routes";
import ProductRoutes from "@modules/product/routes";
import UserRoutes from "@modules/user/routes";
import vendorRoutes from "@modules/vendor/routes";
import adminRoutes from "@modules/admin/routes";
import RiderRoutes from "@modules/rider/routes";
import PublicRoutes from "@modules/public/routes";
import PushRoutes from "@modules/push/routes";
import ReferralRoutes from "@modules/referral/routes";
import { checkConnection, redis } from "@config/redis";
// import { requireAuth } from "middleware/auth";

export const app = express();

// IMPORTANT: Trust proxy - Add this BEFORE rate limiting
app.set("trust proxy", 1);

// 1️⃣ Security headers
app.use(helmet());

// 2️⃣ CORS (tweak origin or use a whitelist in production)

// const oldVercel = "https://dooriteuser-ui.vercel.app";
app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "https://dooriteuser-ui.vercel.app",
      "https://doorrite-admin.netlify.app",
      "https://doorrite-rider-ui.netlify.app",
      "https://doorrite-vendor-ui.netlify.app",
      "https://doorrite-user-ui.netlify.app",
    ],
    credentials: true,
  }),
);

// 3️⃣ Rate limiting
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message:
    "Too many authentication attempts, please try again after 15 minutes",
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
});

const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many registration attempts, please try again after an hour",
});

// 4️⃣ Parse JSON + cookies
app.use(
  express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf.toString();
    },
  }),
);
app.use(cookieParser());

// 5️⃣ Response compression
app.use(compression());

// 6️⃣ Request logging (dev-friendly)
app.use(morgan("dev"));

app.get("/", async (_, res) => {
  try {
    await checkConnection();
    res.send("Welcome to the DoorRite API!");
  } catch (e) {
    res.send("Failed to connect to Reddis");
  }
});

app.get("/health", async (_, res) => {
  try {
    await redis.ping();
    res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
  } catch (err) {
    res
      .status(503)
      .json({ status: "error", timestamp: new Date().toISOString() });
  }
});

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocumet));

app.get("/docs-json", (req: Request, res: Response) => {
  res.json(swaggerDocumet);
});
// …All routes are here….
//Public Routes...
app.use("/api/v1/auth", authLimiter, AuthRoutes);

//I'm only here to fix some issuess
//Private Routes
app.use("/api/v1/users", apiLimiter, UserRoutes);
app.use("/api/v1/vendors", apiLimiter, vendorRoutes);
app.use("/api/v1/products", apiLimiter, ProductRoutes);
app.use("/api/v1/orders", apiLimiter, OrderRoutes);
app.use("/api/v1/admin", apiLimiter, adminRoutes);
app.use("/api/v1/riders", apiLimiter, RiderRoutes);
app.use("/api/v1/publics", webhookLimiter, PublicRoutes);
app.use("/api/v1/push", apiLimiter, PushRoutes);
app.use("/api/v1/referral", apiLimiter, ReferralRoutes);

//MiddleWare
//404 handler

app.use((req: Request, res: Response) => {
  res.status(404).json({ ok: false, error: "Not found" });
});

//Global error handler (simple)
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(err?.status || 500).json({
    ok: false,
    error: err?.message || "Internal server error",
  });
});

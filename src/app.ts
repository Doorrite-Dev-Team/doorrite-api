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

//routes
import AuthRoutes from "@modules/auth/routes";
import OrderRoutes from "@modules/order/routes";
import ProductRoutes from "@modules/product/routes";
import UserRoutes from "@modules/user/routes";
import vendorRoutes from "@modules/vendor/routes";
import adminRoutes from "@modules/admin/routes";
import RiderRoutes from "@modules/rider/routes";
import PublicRoutes from "@modules/public/routes";
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
  })
);

// 3️⃣ Rate limiting (100 reqs per 15m per IP)
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// 4️⃣ Parse JSON + cookies
app.use(express.json());
app.use(cookieParser());

// 5️⃣ Response compression
app.use(compression());

// 6️⃣ Request logging (dev-friendly)
app.use(morgan("dev"));

app.get("/", (req, res) => {
  res.send("Welcome to the DoorRite API!");
});

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocumet));

app.get("/docs-json", (req: Request, res: Response) => {
  res.json(swaggerDocumet);
});
// …All routes are here….
//Public Routes...
app.use("/api/v1/auth", AuthRoutes);

//Private Routes
app.use("/api/v1/user", UserRoutes);
app.use("/api/v1/vendors", vendorRoutes);
app.use("/api/v1/product", ProductRoutes);
app.use("/api/v1/order", OrderRoutes);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1/rider", RiderRoutes);
app.use("/api/v1/");
app.use("/api/v1/public", PublicRoutes);

//MiddleWare
//404 handler

app.use((_: Request, res: Response) => {
  res.status(404).json({ ok: false, error: "Not found" });
});

//Global error handler (simple)
app.use((err: any, _: Request, res: Response, next: NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(err?.status || 500).json({
    ok: false,
    error: err?.message || "Internal server error",
  });
});

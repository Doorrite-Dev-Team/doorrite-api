import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { NextFunction, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import morgan from "morgan";
import swaggerUi from "swagger-ui-express";
const swaggerDocumet = require("../src/swagger-output-json");

//routes
import AuthRoutes from "@modules/auth/auth.routes";
import UserRoutes from "@modules/user/user.routes";
import { requireAuth } from "middleware/auth";

export const app = express();

// IMPORTANT: Trust proxy - Add this BEFORE rate limiting
app.set("trust proxy", 1);

// 1️⃣ Security headers
app.use(helmet());

// 2️⃣ CORS (tweak origin or use a whitelist in production)
app.use(
  cors({
    origin: ["http://localhost:3000", "https://dooriteuser-ui.vercel.app"],
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
app.use("/api/v1/user", requireAuth("user"), UserRoutes);

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
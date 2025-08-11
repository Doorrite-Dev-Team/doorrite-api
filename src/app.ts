import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import morgan from "morgan";

//routes
import userRoutes from "./modules/users/user.route";


export const app = express();

// 1️⃣ Security headers
app.use(helmet());

// 2️⃣ CORS (tweak origin or use a whitelist in production)
app.use(cors());

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


// …All routes are here…
app.use("/api/v1/auth", userRoutes)
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.app = void 0;
const compression_1 = __importDefault(require("compression"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const cors_1 = __importDefault(require("cors"));
const express_1 = __importDefault(require("express"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
//routes
const user_route_1 = __importDefault(require("./modules/users/user.route"));
exports.app = (0, express_1.default)();
// 1️⃣ Security headers
exports.app.use((0, helmet_1.default)());
// 2️⃣ CORS (tweak origin or use a whitelist in production)
exports.app.use((0, cors_1.default)());
// 3️⃣ Rate limiting (100 reqs per 15m per IP)
exports.app.use((0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
}));
// 4️⃣ Parse JSON + cookies
exports.app.use(express_1.default.json());
exports.app.use((0, cookie_parser_1.default)());
// 5️⃣ Response compression
exports.app.use((0, compression_1.default)());
// 6️⃣ Request logging (dev-friendly)
exports.app.use((0, morgan_1.default)("dev"));
exports.app.get("/", (req, res) => {
    res.send("Welcome to the DoorRite API!");
});
// …All routes are here…
exports.app.use("/api/v1/auth", user_route_1.default);

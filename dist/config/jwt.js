"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TEMP_EXPIRES = exports.REFRESH_EXPIRES = exports.ACCESS_EXPIRES = exports.JWT_SECRET = void 0;
exports.createAccessToken = createAccessToken;
exports.createRefreshToken = createRefreshToken;
exports.signJwt = signJwt;
exports.verifyJwt = verifyJwt;
exports.generateOpaqueToken = generateOpaqueToken;
exports.makeAccessTokenForUser = makeAccessTokenForUser;
exports.makeRefreshTokenForUser = makeRefreshTokenForUser;
// src/config/jwt.ts
const crypto_1 = __importDefault(require("crypto"));
const jwt = __importStar(require("jsonwebtoken"));
exports.JWT_SECRET = (process.env.JWT_SECRET ||
    "change_me_here_for_prod");
exports.ACCESS_EXPIRES = process.env.ACCESS_EXPIRES || "15m";
exports.REFRESH_EXPIRES = process.env.REFRESH_EXPIRES || "30d";
exports.TEMP_EXPIRES = process.env.TEMP_EXPIRES || "15m";
function createAccessToken(payload) {
    return jwt.sign(payload, exports.JWT_SECRET, {
        expiresIn: exports.ACCESS_EXPIRES,
    });
}
function createRefreshToken(payload) {
    return jwt.sign(payload, exports.JWT_SECRET, {
        expiresIn: exports.REFRESH_EXPIRES,
    });
}
function signJwt(payload) {
    return jwt.sign(payload, exports.JWT_SECRET, {
        expiresIn: exports.TEMP_EXPIRES,
    });
}
function verifyJwt(token) {
    // Throwing behavior — callers should catch
    return jwt.verify(token, exports.JWT_SECRET);
}
function generateOpaqueToken(len = 48) {
    return crypto_1.default.randomBytes(len).toString("hex");
}
function makeAccessTokenForUser(userId, role) {
    return createAccessToken({ sub: userId, role, type: "access" });
}
function makeRefreshTokenForUser(userId) {
    return createRefreshToken({ sub: userId, type: "refresh" });
}

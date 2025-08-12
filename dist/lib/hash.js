"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.hashPassword = hashPassword;
exports.verifyPassword = verifyPassword;
// src/lib/hash.ts
const argon2_1 = __importDefault(require("argon2"));
async function hashPassword(plain) {
    return await argon2_1.default.hash(plain, { type: argon2_1.default.argon2id });
}
async function verifyPassword(hash, plain) {
    return await argon2_1.default.verify(hash, plain);
}

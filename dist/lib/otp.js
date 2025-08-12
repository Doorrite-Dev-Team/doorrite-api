"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateNumericOtp = generateNumericOtp;
exports.otpExpiryMinutes = otpExpiryMinutes;
// src/lib/otp.ts
function generateNumericOtp(length = 6) {
    const min = 10 ** (length - 1);
    const max = 10 ** length - 1;
    return String(Math.floor(Math.random() * (max - min + 1)) + min);
}
function otpExpiryMinutes() {
    return Number(process.env.OTP_EXPIRY_MINUTES || 15);
}

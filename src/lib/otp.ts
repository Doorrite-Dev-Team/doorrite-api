// src/lib/OTP.ts
export function generateNumericOtp(length = 6) {
  const min = 10 ** (length - 1);
  const max = 10 ** length - 1;
  return String(Math.floor(Math.random() * (max - min + 1)) + min);
}

export function OTPExpiryMinutes() {
  return Number(process.env.OTP_EXPIRY_MINUTES || 15);
}
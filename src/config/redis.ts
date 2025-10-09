// src/lib/otp.ts
import { Redis } from "@upstash/redis";
import "dotenv/config";

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// Configuration (env override)
export const OTP_TTL_SECONDS = Number(process.env.OTP_TTL_SECONDS ?? 600); // 10m
export const MAX_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS ?? 3);
export const OTP_LENGTH = Number(process.env.OTP_LENGTH ?? 6);

// Key helpers
const otpKey = (type: string, identifier: string) =>
  `otp:${type}:${identifier}`; // e.g. otp:EMAIL_VERIFICATION:alice@example.com
const attemptsKey = (type: string, identifier: string) =>
  `otp:attempts:${type}:${identifier}`;
const resetKey = (type: string, identifier: string, token: string) =>
  `otp:reset:${type}:${identifier}:${token}`;

// Utility: generate numeric code
export function generateNumericOtp(length = OTP_LENGTH): string {
  let s = "";
  for (let i = 0; i < length; i++)
    s += Math.floor(Math.random() * 10).toString();
  return s;
}

/**
 * createOtp(type, identifier)
 * - atomically sets OTP only if no existing key
 * - sets attempts key to 0 with same TTL
 * returns: { ok: true, code, ttlSeconds } or { ok: false, reason: 'exists', ttlSeconds? }
 */
export async function createOtp(type: string, identifier: string) {
  const kOtp = otpKey(type, identifier);
  const kAttempts = attemptsKey(type, identifier);

  const code = generateNumericOtp();

  // atomic set-if-not-exists + set TTL
  const setResult = await redis.set(kOtp, code, {
    nx: true,
    ex: OTP_TTL_SECONDS,
  });

  if (!setResult) {
    const ttl = await redis.ttl(kOtp);
    return {
      ok: false as const,
      reason: "exists" as const,
      ttlSeconds: ttl >= 0 ? ttl : undefined,
    };
  }

  await redis.set(kAttempts, "0", { ex: OTP_TTL_SECONDS });
  return { ok: true as const, code, ttlSeconds: OTP_TTL_SECONDS };
}

/**
 * verifyOtp(type, identifier, code)
 * - checks attempts
 * - compares code
 * - on success deletes otp + attempts keys
 * returns:
 *  { ok: true }
 *  { ok: false, reason: 'blocked'|'expired'|'invalid'|'blocked_after_failed', attempts?:number, remaining?:number }
 */
export async function verifyOtp(
  type: string,
  identifier: string,
  code: string
) {
  const kOtp = otpKey(type, identifier);
  const kAttempts = attemptsKey(type, identifier);

  const attemptsRaw = await redis.get(kAttempts);
  const attempts = attemptsRaw ? parseInt(String(attemptsRaw), 10) : 0;
  if (attempts >= MAX_ATTEMPTS) {
    return {
      ok: false as const,
      reason: "blocked" as const,
      attempts,
      remaining: 0,
    };
  }

  const stored = await redis.get(kOtp);
  if (!stored) return { ok: false as const, reason: "expired" as const };

  if (String(stored) === String(code)) {
    // success: delete both keys
    await redis.del(kOtp, kAttempts);
    return { ok: true as const };
  }

  // wrong: increment attempts atomically
  const newAttempts = await redis.incr(kAttempts);
  // ensure TTL aligns
  const attTTL = await redis.ttl(kAttempts);
  if (attTTL === -1) {
    const otpTTL = await redis.ttl(kOtp);
    if (otpTTL > 0) await redis.expire(kAttempts, otpTTL);
    else await redis.expire(kAttempts, OTP_TTL_SECONDS);
  }

  if (newAttempts >= MAX_ATTEMPTS) {
    return {
      ok: false as const,
      reason: "blocked_after_failed" as const,
      attempts: newAttempts,
      remaining: 0,
    };
  }

  return {
    ok: false as const,
    reason: "invalid" as const,
    attempts: newAttempts,
    remaining: Math.max(0, MAX_ATTEMPTS - newAttempts),
  };
}

/**
 * deleteOtp(type, identifier)
 * - deletes otp & attempts (useful on send-failure cleanup)
 */
export async function deleteOtp(type: string, identifier: string) {
  await redis.del(otpKey(type, identifier), attemptsKey(type, identifier));
}

/**
 * getOtpStatus(type, identifier)
 * - returns existence, TTL, attempts, remaining
 */
export async function getOtpStatus(type: string, identifier: string) {
  const [existsRaw, ttlRaw, attemptsRaw] = await Promise.all([
    redis.get(otpKey(type, identifier)),
    redis.ttl(otpKey(type, identifier)),
    redis.get(attemptsKey(type, identifier)),
  ]);
  const exists = !!existsRaw;
  const ttl = typeof ttlRaw === "number" && ttlRaw >= 0 ? ttlRaw : undefined;
  const attempts = attemptsRaw ? parseInt(String(attemptsRaw), 10) : 0;
  return {
    exists,
    ttlSeconds: ttl,
    attempts,
    remaining: Math.max(0, MAX_ATTEMPTS - attempts),
  };
}

/**
 * resetToken helpers (for password reset flow)
 * - createResetToken(type, identifier) -> token (stored in redis with TTL 15m)
 * - validateResetToken(type, identifier, token) -> boolean
 * - deleteResetToken(...)
 */
export async function createResetToken(
  type: string,
  identifier: string,
  ttlSeconds = 15 * 60
) {
  const token = cryptoRandomHex(32);
  await redis.set(resetKey(type, identifier, token), "1", { ex: ttlSeconds });
  return { token, ttlSeconds };
}

export async function validateResetToken(
  type: string,
  identifier: string,
  token: string
) {
  const k = resetKey(type, identifier, token);
  const v = await redis.get(k);
  return !!v;
}

export async function deleteResetToken(
  type: string,
  identifier: string,
  token: string
) {
  await redis.del(resetKey(type, identifier, token));
}

/** small helper */
function cryptoRandomHex(len: number) {
  // use Node crypto via dynamic import to avoid top-level require issues in ESM + browsers
  // but in Node simple require is okay
  const crypto = require("crypto");
  return crypto.randomBytes(len).toString("hex");
}

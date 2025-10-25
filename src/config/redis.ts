import { Redis } from "@upstash/redis";
import "dotenv/config";
import * as crypto from "crypto";

// =====================================================================
// 1. CONFIGURATION & REDIS CLIENT
// ---------------------------------------------------------------------

/** Upstash Redis Client Initialization. */
export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// --- CODE CONFIGURATION ---

/** Time-To-Live (TTL) for Authentication OTP codes (in seconds). Default: 10 minutes. */
export const OTP_TTL_SECONDS = Number(process.env.OTP_TTL_SECONDS ?? 600);

/** Maximum allowed verification attempts for an AUTH OTP code. Default: 3. */
export const AUTH_MAX_ATTEMPTS = Number(process.env.AUTH_MAX_ATTEMPTS ?? 3);

/** Length of generated numeric codes (for both OTP and OC). Default: 6 digits. */
export const CODE_LENGTH = Number(process.env.CODE_LENGTH ?? 6);

// --- ORDER CONFIRMATION CONFIGURATION ---

/**
 * Time-To-Live (TTL) for Order Confirmation (OC) codes (in seconds).
 * Set to 24 hours (86400s) as per requirement.
 */
export const OC_TTL_SECONDS = 86400;

/** Maximum allowed verification attempts for an OC code. Default: 6. */
export const OC_MAX_ATTEMPTS = Number(process.env.OC_MAX_ATTEMPT ?? 6);

// =====================================================================
// 2. KEY GENERATION HELPERS
// ---------------------------------------------------------------------

// --- Authentication (OTP) Keys ---

/** Generates the Redis key for storing the actual OTP code. */
const getAuthKey = (type: string, identifier: string) =>
  `auth:otp:${type}:${identifier}`;

/** Generates the Redis key for tracking OTP verification attempts. */
const getAuthAttemptsKey = (type: string, identifier: string) =>
  `auth:otp:attempts:${type}:${identifier}`;

/** Generates the Redis key for temporary password reset tokens. */
const getResetTokenKey = (type: string, identifier: string, token: string) =>
  `auth:reset:${type}:${identifier}:${token}`;

// --- Order Confirmation (OC) Keys ---

/** Generates the Redis key for storing the Order Confirmation code. */
const getOrderConfirmKey = (
  riderId: string,
  vendorId: string,
  orderId: string
) => `oc:code:${riderId}:${vendorId}:${orderId}`;

/** Generates the Redis key for tracking OC verification attempts. */
const getOrderConfirmAttemptsKey = (
  riderId: string,
  vendorId: string,
  orderId: string
) => `oc:attempts:${riderId}:${vendorId}:${orderId}`;

// =====================================================================
// 3. UTILITIES
// ---------------------------------------------------------------------

/** Generates a random numeric string of a specified length. */
export function generateNumericCode(length = CODE_LENGTH): string {
  let s = "";
  for (let i = 0; i < length; i++) {
    s += Math.floor(Math.random() * 10).toString();
  }
  return s;
}

/** Generates a cryptographically secure random hexadecimal string. */
function generateRandomHex(len: number): string {
  // Use Node.js crypto module for strong token generation
  return crypto.randomBytes(len).toString("hex");
}

// =====================================================================
// 4. AUTHENTICATION (OTP) LOGIC
// ---------------------------------------------------------------------

// --- Types for OTP Responses ---

export type CreateOtpSuccess = {
  ok: true;
  code: string;
  ttlSeconds: number;
  status: "created";
};
export type CreateOtpExists = {
  ok: false;
  reason: "exists";
  ttlSeconds: number | undefined;
};
export type CreateOtpResult = CreateOtpSuccess | CreateOtpExists;

/**
 * Creates and stores a new OTP code.
 * Atomically sets the OTP only if no key exists, ensuring no overwrite.
 * Sets the associated attempts key to 0 with the same TTL.
 * @param type E.g., 'EMAIL_VERIFICATION', 'PHONE_LOGIN'.
 * @param identifier E.g., 'alice@example.com', '+15551234'.
 * @returns Status of creation or existence.
 */
export async function createOtp(
  type: string,
  identifier: string
): Promise<CreateOtpResult> {
  const kOtp = getAuthKey(type, identifier);
  const kAttempts = getAuthAttemptsKey(type, identifier);

  const code = generateNumericCode();

  // Atomically set OTP code only if it does NOT exist (nx: true)
  const setResult = await redis.set(kOtp, code, {
    nx: true,
    ex: OTP_TTL_SECONDS,
  });

  if (!setResult) {
    // Key already exists, return failure with current TTL
    const ttl = await redis.ttl(kOtp);
    return {
      ok: false as const,
      reason: "exists" as const,
      ttlSeconds: ttl >= 0 ? ttl : undefined,
    };
  }

  // Set attempts to 0 with same TTL
  await redis.set(kAttempts, "0", { ex: OTP_TTL_SECONDS });

  return {
    ok: true as const,
    code,
    ttlSeconds: OTP_TTL_SECONDS,
    status: "created",
  };
}

// --- Types for OTP Verification ---

export type VerifyOtpSuccess = { ok: true };
export type VerifyOtpFailure = {
  ok: false;
  reason: "blocked" | "expired" | "invalid" | "blocked_after_failed";
  attempts: number;
  remaining: number;
};
export type VerifyOtpResult = VerifyOtpSuccess | VerifyOtpFailure;

/**
 * Verifies the provided code against the stored OTP.
 * Increments attempts on failure. Deletes keys on success.
 * @returns Status of verification (success/failure reason).
 */
export async function verifyOtp(
  type: string,
  identifier: string,
  code: string
): Promise<VerifyOtpResult> {
  const kOtp = getAuthKey(type, identifier);
  const kAttempts = getAuthAttemptsKey(type, identifier);
  const maxAttempts = AUTH_MAX_ATTEMPTS;

  const [stored, attemptsRaw] = await Promise.all([
    redis.get(kOtp),
    redis.get(kAttempts),
  ]);

  const attempts = attemptsRaw ? parseInt(String(attemptsRaw), 10) : 0;
  const remaining = Math.max(0, maxAttempts - attempts);

  // Guard: Check if the OTP has expired
  if (!stored) {
    return {
      ok: false as const,
      reason: "expired" as const,
      attempts,
      remaining: 0,
    };
  }

  // Guard: Check if the user is already blocked
  if (attempts >= maxAttempts) {
    return {
      ok: false as const,
      reason: "blocked" as const,
      attempts,
      remaining: 0,
    };
  }

  // Success: Code matches
  if (String(stored) === String(code)) {
    await redis.del(kOtp, kAttempts); // Auto-delete on verification
    return { ok: true as const };
  }

  // Failure: Code is invalid. Increment attempts.
  const newAttempts = await redis.incr(kAttempts);

  // Set the TTL on attempts key if it somehow expired (safety net)
  const attemptsTTL = await redis.ttl(kAttempts);
  if (attemptsTTL <= 0) {
    const otpTTL = await redis.ttl(kOtp);
    // If the OTP is still alive, reset attempts TTL to match it.
    if (otpTTL > 0) await redis.expire(kAttempts, otpTTL);
  }

  // Final check after increment
  if (newAttempts >= maxAttempts) {
    return {
      ok: false as const,
      reason: "blocked_after_failed" as const,
      attempts: newAttempts,
      remaining: 0,
    };
  }

  // Invalid code, but attempts remaining
  return {
    ok: false as const,
    reason: "invalid" as const,
    attempts: newAttempts,
    remaining: Math.max(0, maxAttempts - newAttempts),
  };
}

/** Deletes the OTP code and its associated attempts key. */
export async function deleteOtp(type: string, identifier: string) {
  await redis.del(
    getAuthKey(type, identifier),
    getAuthAttemptsKey(type, identifier)
  );
}

// --- Reset Token Helpers (Password Reset Flow) ---

/**
 * Creates a temporary, cryptographically secure reset token.
 * @returns The generated token and its TTL.
 */
export async function createResetToken(
  type: string,
  identifier: string,
  ttlSeconds = 15 * 60 // Default 15 minutes
) {
  const token = generateRandomHex(32);
  await redis.set(getResetTokenKey(type, identifier, token), "1", {
    ex: ttlSeconds,
  });
  return { token, ttlSeconds };
}

/** Validates if a given reset token is active. */
export async function validateResetToken(
  type: string,
  identifier: string,
  token: string
) {
  const k = getResetTokenKey(type, identifier, token);
  const v = await redis.get(k);
  return !!v;
}

/** Deletes a reset token (typically after a successful password update). */
export async function deleteResetToken(
  type: string,
  identifier: string,
  token: string
) {
  await redis.del(getResetTokenKey(type, identifier, token));
}

// =====================================================================
// 5. ORDER CONFIRMATION (OC) LOGIC
// ---------------------------------------------------------------------

// --- Types for OC Responses ---

export type CreateOcSuccess = {
  ok: true;
  code: string;
  ttlSeconds: number;
  status: "created";
};
export type CreateOcRetrieved = {
  ok: true;
  code: string;
  ttlSeconds: number | undefined;
  status: "retrieved";
};
export type CreateOcResult = CreateOcSuccess | CreateOcRetrieved;

/**
 * Creates and stores an Order Confirmation code (OC).
 * REQUIRED: If a code already exists (e.g., within 24 hours), the existing code is retrieved
 * and returned successfully, not an error.
 * @returns Status of creation or retrieval, and the code.
 */
export async function createOCCode(
  riderId: string,
  vendorId: string,
  orderId: string
): Promise<CreateOcResult> {
  const kOC = getOrderConfirmKey(riderId, vendorId, orderId);
  const kAttempts = getOrderConfirmAttemptsKey(riderId, vendorId, orderId);
  const ttlSeconds = OC_TTL_SECONDS;

  const code = generateNumericCode();

  // Attempt to set a NEW code only if it does NOT exist (nx: true)
  const setResult = await redis.set(kOC, code, {
    nx: true,
    ex: ttlSeconds,
  });

  if (!setResult) {
    // -----------------------------------------------------------
    // REQUIRED LOGIC: Key already exists, retrieve and return code
    // -----------------------------------------------------------
    const [existingCode, ttl] = await Promise.all([
      redis.get(kOC),
      redis.ttl(kOC),
    ]);

    // If for some reason the key existed but we couldn't get the value (race condition or near-expiry),
    // we return the successful retrieval and let the caller handle the missing code.
    const existingCodeString = existingCode ? String(existingCode) : code;

    return {
      ok: true as const,
      code: existingCodeString,
      ttlSeconds: ttl >= 0 ? ttl : undefined,
      status: "retrieved" as const,
    };
  }

  // New code created: set attempts to 0 with same TTL
  await redis.set(kAttempts, "0", { ex: ttlSeconds });

  return { ok: true as const, code, ttlSeconds, status: "created" as const };
}

// --- Types for OC Verification ---

export type VerifyOcSuccess = { ok: true };
export type VerifyOcFailure = {
  ok: false;
  reason: "blocked" | "expired" | "invalid" | "blocked_after_failed";
  attempts: number;
  remaining: number;
};
export type VerifyOcResult = VerifyOcSuccess | VerifyOcFailure;

/**
 * Verifies the Order Confirmation code.
 * Uses OC_MAX_ATTEMPTS. Deletes keys on successful verification.
 * @returns Status of verification (success/failure reason).
 */
export async function verifyOCCode(
  riderId: string,
  vendorId: string,
  orderId: string,
  code: string
): Promise<VerifyOcResult> {
  const kOC = getOrderConfirmKey(riderId, vendorId, orderId);
  const kAttempts = getOrderConfirmAttemptsKey(riderId, vendorId, orderId);
  const maxAttempts = OC_MAX_ATTEMPTS;

  const [stored, attemptsRaw] = await Promise.all([
    redis.get(kOC),
    redis.get(kAttempts),
  ]);

  const attempts = attemptsRaw ? parseInt(String(attemptsRaw), 10) : 0;
  const remaining = Math.max(0, maxAttempts - attempts);

  // Guard: Check if OC code has expired
  if (!stored) {
    return {
      ok: false as const,
      reason: "expired" as const,
      attempts,
      remaining: 0,
    };
  }

  // Guard: Check if the user is already blocked
  if (attempts >= maxAttempts) {
    return {
      ok: false as const,
      reason: "blocked" as const,
      attempts,
      remaining: 0,
    };
  }

  // Success: Code matches
  if (String(stored) === String(code)) {
    // Auto-delete on verification (REQUIRED)
    await redis.del(kOC, kAttempts);
    return { ok: true as const };
  }

  // Failure: Code is invalid. Increment attempts.
  const newAttempts = await redis.incr(kAttempts);

  // Safety net: ensure attempts key still has a TTL if the code is still alive
  const attemptsTTL = await redis.ttl(kAttempts);
  if (attemptsTTL <= 0) {
    const ocTTL = await redis.ttl(kOC);
    if (ocTTL > 0) await redis.expire(kAttempts, ocTTL);
  }

  // Final check after increment
  if (newAttempts >= maxAttempts) {
    return {
      ok: false as const,
      reason: "blocked_after_failed" as const,
      attempts: newAttempts,
      remaining: 0,
    };
  }

  // Invalid code, but attempts remaining
  return {
    ok: false as const,
    reason: "invalid" as const,
    attempts: newAttempts,
    remaining: Math.max(0, maxAttempts - newAttempts),
  };
}

/** Deletes the OC code and its associated attempts key. */
export async function deleteOCCode(
  riderId: string,
  vendorId: string,
  orderId: string
) {
  await redis.del(
    getOrderConfirmKey(riderId, vendorId, orderId),
    getOrderConfirmAttemptsKey(riderId, vendorId, orderId)
  );
}

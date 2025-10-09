import axios, { AxiosInstance } from "axios";
import crypto from "crypto";
import { AppError } from "@lib/utils/AppError";

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || "";
const PAYSTACK_BASE_URL =
  process.env.PAYSTACK_BASE_URL || "https://api.paystack.co";

if (!PAYSTACK_SECRET_KEY) {
  // Fail fast in development when not configured
  // In production, env should be set by deployment
  // We throw an AppError so upstream handlers can produce a nice response if used at runtime.
  throw new AppError(
    500,
    "PAYSTACK_SECRET_KEY is not configured in environment"
  );
}

const client: AxiosInstance = axios.create({
  baseURL: PAYSTACK_BASE_URL,
  headers: {
    Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
    "Content-Type": "application/json",
  },
  timeout: 10000,
});

// Types
export type InitializeOptions = {
  email: string;
  amount: number; // in Naira (will be converted to kobo/cents by the helper)
  reference?: string;
  callback_url?: string;
  metadata?: Record<string, any>;
};

export type InitializeResult = {
  authorization_url: string;
  access_code?: string;
  reference: string;
  raw: any;
};

export type VerifyResult = { raw: any };

export type RefundResult = { raw: any };

/**
 * Initialize a Paystack transaction
 */
export async function initializeTransaction(
  opts: InitializeOptions
): Promise<InitializeResult> {
  try {
    const payload = {
      email: opts.email,
      amount: Math.round(opts.amount * 100), // convert to kobo
      reference: opts.reference,
      callback_url: opts.callback_url,
      metadata: opts.metadata,
    } as any;

    // Remove undefined keys
    Object.keys(payload).forEach(
      (k) => payload[k] === undefined && delete payload[k]
    );

    const resp = await client.post("/transaction/initialize", payload);
    
    if (!resp.data || resp.data.status !== true) {
      throw new Error(resp.data?.message || "Paystack initialize failed");
    }

    const d = resp.data.data;
    return {
      authorization_url: d.authorization_url,
      access_code: d.access_code,
      reference: d.reference,
      raw: d,
    };
  } catch (err: any) {
    throw new AppError(
      502,
      `Paystack initialize error: ${err?.message || err}`
    );
  }
}

/**
 * Verify transaction status by reference
 */
export async function verifyTransaction(
  reference: string
): Promise<VerifyResult> {
  try {
    const resp = await client.get(
      `/transaction/verify/${encodeURIComponent(reference)}`
    );
    if (!resp.data || resp.data.status !== true) {
      throw new Error(resp.data?.message || "Paystack verify failed");
    }

    return { raw: resp.data.data };
  } catch (err: any) {
    throw new AppError(502, `Paystack verify error: ${err?.message || err}`);
  }
}

/**
 * Create a refund for a transaction
 * amount is optional and in major currency unit (Naira)
 */
export async function refundTransaction(
  transactionReference: string,
  amount?: number
): Promise<RefundResult> {
  try {
    const payload: any = { transaction: transactionReference };
    if (amount !== undefined) payload.amount = Math.round(amount * 100);

    const resp = await client.post(`/refund`, payload);
    if (!resp.data || resp.data.status !== true) {
      throw new Error(resp.data?.message || "Paystack refund failed");
    }

    return { raw: resp.data.data };
  } catch (err: any) {
    throw new AppError(502, `Paystack refund error: ${err?.message || err}`);
  }
}

/**
 * Validate webhook signature from Paystack
 * Paystack sends `x-paystack-signature` header with sha512 HMAC of the raw body using the secret key
 */
export function validateWebhookSignature(
  rawBody: string,
  signatureHeader?: string | string[] | undefined
): boolean {
  if (!signatureHeader || Array.isArray(signatureHeader)) return false;
  const computed = crypto
    .createHmac("sha512", PAYSTACK_SECRET_KEY)
    .update(rawBody)
    .digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(computed),
    Buffer.from(signatureHeader)
  );
}

export default {
  initializeTransaction,
  verifyTransaction,
  refundTransaction,
  validateWebhookSignature,
};

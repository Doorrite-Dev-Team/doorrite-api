import Paystack from "paystack-sdk";
import crypto from "crypto";
import { AppError } from "@lib/utils/AppError";
import { Transaction } from "paystack-sdk/dist/transaction/interface";

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || "";

if (!PAYSTACK_SECRET_KEY) {
  throw new AppError(500, "PAYSTACK_SECRET_KEY is not configured");
}

const paystack = new Paystack(PAYSTACK_SECRET_KEY);

/**
 * Initialize a Paystack transaction
 * @param email - Customer email
 * @param amount - Amount in Naira (will be converted to kobo)
 * @param reference - Unique transaction reference
 * @param callback_url - URL to redirect after payment
 * @param metadata - Additional transaction metadata
 * @returns Transaction initialization data or null on error
 */
export async function initializeTransaction(
  email: string,
  amount: number,
  reference?: string,
  callback_url?: string,
  metadata?: Record<string, any>,
) {
  try {
    const response = await paystack.transaction.initialize({
      email,
      amount: String(Math.round(amount * 100)),
      reference,
      callback_url,
      metadata,
    });

    if (!response.status) {
      console.error("Paystack initialize failed:", response.message);
      return null;
    }

    return response.data;
  } catch (error: any) {
    throw new AppError(502, `Payment initialization failed: ${error?.message}`);
  }
}

/**
 * Verify a Paystack transaction
 * @param reference - Transaction reference to verify
 * @returns Verification data or null on error
 */
export async function verifyTransaction(reference: string) {
  try {
    const response = await paystack.transaction.verify(reference);

    if (!response.status) {
      console.error("Paystack verification failed:", response.message);
      return null;
    }

    return response.data;
  } catch (error: any) {
    throw new AppError(502, `Payment verification failed: ${error?.message}`);
  }
}

/**
 * Create a refund for a transaction
 * @param transactionReference - Transaction reference or ID
 * @param amount - Amount to refund in Naira (optional, defaults to full amount)
 * @param merchant_note - Internal note about the refund
 * @param customer_note - Note visible to customer
 * @returns Refund data or null on error
 */
export async function refundTransaction(
  transactionReference: string,
  amount?: number,
  merchant_note?: string,
  customer_note?: string,
) {
  try {
    const response = await paystack.refund.create({
      transaction: transactionReference,
      amount: amount ? Math.round(amount * 100) : undefined,
      merchant_note,
      customer_note,
    });

    if (!response.status) {
      console.error("Paystack refund failed:", response.message);
      return null;
    }

    return response.data;
  } catch (error: any) {
    throw new AppError(502, `Refund processing failed: ${error?.message}`);
  }
}

/**
 * Validate Paystack webhook signature
 * @param rawBody - Raw request body as string
 * @param signature - Signature from x-paystack-signature header
 * @returns true if signature is valid
 */
export function validateWebhookSignature(
  rawBody: string,
  signature?: string,
): boolean {
  if (!signature) return false;
  try {
    const hash = crypto
      .createHmac("sha512", PAYSTACK_SECRET_KEY)
      .update(rawBody)
      .digest("hex");

    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature));
  } catch (error) {
    return false;
  }
}

export const toKobo = (naira: number) => Math.round(naira * 100);
export const toNaira = (kobo: number) => kobo / 100;

/**
 * Check if transaction was successful
 */
export function isTransactionSuccessful(data: Transaction | null): boolean {
  return data?.status === "success";
}

/**
 * Check if transaction failed
 */
export function isTransactionFailed(data: Transaction | null): boolean {
  return data?.status === "failed";
}

export default {
  initializeTransaction,
  verifyTransaction,
  refundTransaction,
  validateWebhookSignature,
  toKobo,
  toNaira,
  isTransactionSuccessful,
  isTransactionFailed,
};

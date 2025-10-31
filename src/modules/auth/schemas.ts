import { listAllowedCategoryKeys } from "@lib/category";
import { addressSchema } from "@lib/utils/address";
import z from "zod";

/* ======================
   Zod schemas
   ====================== */
export const signupSchema = z.object({
  fullName: z.string().min(2).max(100),
  email: z.string().email(),
  phoneNumber: z
    .string()
    .regex(
      /^(\+234|0)[789][01]\d{8}$/,
      "Please enter a valid Nigerian phone number"
    ),
  password: z
    .string()
    .min(8)
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      "Password must contain uppercase, lowercase, and number"
    ),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const emailSchema = z.object({
  email: z.string().email(),
});

export const otpSchema = z.object({
  email: z.string().email(),
  otp: z
    .string()
    .length(6)
    .regex(/^\d{6}$/, "OTP must contain only numbers"),
  purpose: z.enum(["verify", "reset"]).optional(),
});

export const resetPasswordSchema = z
  .object({
    email: z.string().email(),
    password: z.string().min(8),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const vendorSignupSchema = z.object({
  businessName: z.string().min(2).max(100),
  email: z.string().email(),
  phoneNumber: z
    .string()
    .regex(
      /^(\+234|0)[789][01]\d{8}$/,
      "Please enter a valid Nigerian phone number"
    ),
  password: z
    .string()
    .min(8)
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      "Password must contain uppercase, lowercase, and number"
    ),
  addresss: addressSchema,
  // categoryIds: z.array(z.includes(listAllowedCategoryKeys))
});

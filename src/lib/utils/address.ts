import { z } from "zod/v3";

export const coordinatesSchema = z.object({
  lat: z
    .number({
      required_error: "Latitude is required",
      invalid_type_error: "Latitude must be a number",
    })
    .min(-90, "Latitude must be ≥ -90")
    .max(90, "Latitude must be ≤ 90"),
  long: z
    .number({
      required_error: "Longitude is required",
      invalid_type_error: "Longitude must be a number",
    })
    .min(-180, "Longitude must be ≥ -180")
    .max(180, "Longitude must be ≤ 180"),
});

export const addressSchema = z.object({
  address: z
    .string({
      required_error: "Address is required",
      invalid_type_error: "Address must be a string",
    })
    .min(5, "Address must be at least 5 characters long")
    .max(200, "Address must be under 200 characters"),
  coordinates: coordinatesSchema,
  state: z
    .string()
    .optional()
    .default("Ilorin")
    .transform((s) => s.trim()),
  country: z
    .string()
    .optional()
    .default("Nigeria")
    .transform((s) => s.trim()),
});

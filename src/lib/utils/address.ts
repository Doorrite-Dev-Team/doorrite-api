import prisma from "@config/db";
import { Address } from "../../generated/prisma";
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

export async function deleteUserAdress(
  id: string,
  addressStringToDelete: string
) {
  // 1. Find the entity and get their current addresses.
  const userRecord = await prisma.user.findUnique({
    where: { id: id },
    select: { address: true },
  });

  if (!userRecord) {
    console.error("user not found");
    return;
  }

  // 2. Filter the addresses in your code to create a new array
  //    without the address you want to delete.
  const updatedAddresses = userRecord.address.filter(
    (addr: Address) => addr.address !== addressStringToDelete
  );

  // 3. Update the entity record with the new, filtered array of addresses.
  const updatedUser = await prisma.user.update({
    where: { id },
    data: {
      // The 'set' command replaces the entire array.
      address: {
        set: updatedAddresses,
      },
    },
  });

  console.log("entity updated after address deletion:", updatedUser);
  return updatedUser;
}

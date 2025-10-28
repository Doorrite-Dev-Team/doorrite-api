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

export async function deleteAddressFromEntity(
  entity: "user" | "vendor" | "rider",
  entityId: string,
  addressStringToDelete: string
) {
  // 1. Find the entity and get their current addresses.
  let entityRecord: { address: Address[] } | null = null;

  // if (entity === "user") {
  //   entityRecord = await prisma.user.findUnique({
  //     where: { id: entityId },
  //     select: { address: true },
  //   });
  // } else if (entity === "vendor") {
  //   entityRecord = await prisma.vendor.findUnique({
  //     where: { id: entityId },
  //     select: { address: true },
  //   });
  // } else {
  //   entityRecord = await prisma.rider.findUnique({
  //     where: { id: entityId },
  //     select: { address: true },
  //   });
  // }

  switch (entity) {
    case "user":
      entityRecord = await prisma.user.findUnique({
        where: { id: entityId },
        select: { address: true },
      });
      break;

    case "vendor":
      entityRecord = await prisma.vendor.findUnique({
        where: { id: entityId },
        select: { address: true },
      });
      break;

    default:
      entityRecord = await prisma.rider.findUnique({
        where: { id: entityId },
        select: { address: true },
      });
      break;
  }

  if (!entityRecord) {
    console.error(`${entity} not found`);
    return;
  }

  // 2. Filter the addresses in your code to create a new array
  //    without the address you want to delete.
  const updatedAddresses = entityRecord.address.filter(
    (addr: Address) => addr.address !== addressStringToDelete
  );

  // 3. Update the entity record with the new, filtered array of addresses.
  let updatedEntity;
  // if (entity === "user") {
  //   updatedEntity = await prisma.user.update({
  //     where: { id: entityId },
  //     data: {
  //       // The 'set' command replaces the entire array.
  //       address: {
  //         set: updatedAddresses,
  //       },
  //     },
  //   });
  // } else if (entity === "vendor") {
  //   updatedEntity = await prisma.vendor.update({
  //     where: { id: entityId },
  //     data: {
  //       address: {
  //         set: updatedAddresses,
  //       },
  //     },
  //   });
  // } else {
  //   updatedEntity = await prisma.rider.update({
  //     where: { id: entityId },
  //     data: {
  //       address: {
  //         set: updatedAddresses,
  //       },
  //     },
  //   });
  // }

  switch (entity) {
    case "user":
      updatedEntity = await prisma.user.update({
        where: { id: entityId },
        data: {
          // The 'set' command replaces the entire array.
          address: {
            set: updatedAddresses,
          },
        },
      });
      break;
    case "vendor":
      updatedEntity = await prisma.vendor.update({
        where: { id: entityId },
        data: {
          address: {
            set: updatedAddresses,
          },
        },
      });
      break;

    default:
      updatedEntity = await prisma.rider.update({
        where: { id: entityId },
        data: {
          address: {
            set: updatedAddresses,
          },
        },
      });
      break;
  }

  console.log("entity updated after address deletion:", updatedEntity);
  return updatedEntity;
}

// Example of how you would call this function:
deleteAddressFromEntity("user", "some-user-id", "123 Main St, Anytown");

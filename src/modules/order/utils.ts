import { z } from "zod/v3";
import { addressSchema } from "@lib/utils/address";
import prisma from "@config/db";
import { AppError } from "@lib/utils/AppError";

// Modifier selection schema
export const modifierSelectionSchema = z.object({
  modifierGroupId: z
    .string({ required_error: "modifierGroupId is required" })
    .min(1, "modifierGroupId cannot be empty"),
  selectedOptions: z
    .array(
      z.object({
        modifierOptionId: z
          .string({ required_error: "modifierOptionId is required" })
          .min(1, "modifierOptionId cannot be empty"),
        quantity: z.number().int().min(1).default(1),
      })
    )
    .min(1, "At least one option must be selected"),
});

// Order item schema
export const orderItemSchema = z.object({
  productId: z
    .string({ required_error: "productId is required" })
    .min(1, "productId cannot be empty"),
  variantId: z.string().nullable().optional(),
  quantity: z
    .number({ required_error: "quantity is required" })
    .int("quantity must be an integer")
    .positive("quantity must be greater than 0"),
  modifiers: z.array(modifierSelectionSchema).optional(),
});

// Create order body schema
export const createOrderSchema = z.object({
  vendorId: z
    .string({ required_error: "vendorId is required" })
    .min(1, "vendorId cannot be empty"),
  items: z.array(orderItemSchema).nonempty("items array must not be empty"),
  deliveryAddress: addressSchema,
  contactInfo: z.object({
    fullName: z.string(),
    phone: z.string(),
    email: z.string().email(),
    instructions: z.string().optional(),
  }),
  paymentMethod: z.enum(["PAYSTACK", "CASH_ON_DELIVERY"], {
    required_error: "paymentMethod is required",
  }),
});

//Helper function to calculate order total
// export const calculateOrderTotal = async (
//   items: CreateOrderItem[],
// ): Promise<number> => {
//   let total = 0;
//   for (const item of items) {
//     // Get product price (or variant price if variant is specified)
//     const product = await prisma?.product.findUnique({
//       where: { id: item.productId },
//       include: {
//         variants: item.variantId ? { where: { id: item.variantId } } : false,
//       },
//     });
//     if (!product) {
//       throw new Error(`Product with id ${item.productId} not found`);
//     }
//     // Check if variant exists when specified
//     if (item.variantId) {
//       const variant = await prisma?.productVariant.findUnique({
//         where: { id: item.variantId },
//       });
//       if (!variant) {
//         throw new Error(`Product variant with id ${item.variantId} not found`);
//       }
//       total += variant.price * item.quantity;
//     } else {
//       // Assuming product has a base price field
//       total += product.basePrice * item.quantity;
//     }
//   }
//   return total;
// };

// Update calculateOrderTotal function

export async function calculateOrderTotal(items: any[]): Promise<number> {
  let total = 0;

  for (const item of items) {
    const { productId, variantId, quantity = 1 } = item;

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { basePrice: true },
    });

    if (!product) throw new AppError(404, `Product ${productId} not found`);

    let basePrice = product.basePrice;

    if (variantId) {
      const variant = await prisma.productVariant.findUnique({
        where: { id: variantId },
        select: { price: true },
      });
      if (variant) basePrice = variant.price;
    }

    total += basePrice * quantity;
  }

  return total;
}

/**
 * Validates product availability, stock, and modifiers.
 * Returns the data structure for Prisma nested creation.
 */

export const generateCode = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

// Type inference (for use elsewhere)
export type CreateOrderBody = z.infer<typeof createOrderSchema>;
export type CreateOrderItem = z.infer<typeof orderItemSchema>;
export type Address = z.infer<typeof addressSchema>;

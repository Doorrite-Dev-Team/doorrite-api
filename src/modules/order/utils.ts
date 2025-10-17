import { z } from "zod/v3";
import { addressSchema } from "@lib/utils/address";
import prisma from "@config/db";

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
});

// Create order body schema
export const createOrderSchema = z.object({
  vendorId: z
    .string({ required_error: "vendorId is required" })
    .min(1, "vendorId cannot be empty"),
  items: z.array(orderItemSchema).nonempty("items array must not be empty"),
  deliveryAddress: addressSchema,
  paymentMethod: z.enum(["PAYSTACK", "CASH_ON_DELIVERY"], {
    required_error: "paymentMethod is required",
  }),
});

//Helper function to calculate order total
export const calculateOrderTotal = async (
  items: CreateOrderItem[]
): Promise<number> => {
  let total = 0;
  for (const item of items) {
    // Get product price (or variant price if variant is specified)
    const product = await prisma?.product.findUnique({
      where: { id: item.productId },
      include: {
        variants: item.variantId ? { where: { id: item.variantId } } : false,
      },
    });
    if (!product) {
      throw new Error(`Product with id ${item.productId} not found`);
    }
    // Check if variant exists when specified
    if (item.variantId) {
      const variant = await prisma?.productVariant.findUnique({
        where: { id: item.variantId },
      });
      if (!variant) {
        throw new Error(`Product variant with id ${item.variantId} not found`);
      }
      total += variant.price * item.quantity;
    } else {
      // Assuming product has a base price field
      total += product.basePrice * item.quantity;
    }
  }
  return total;
};

// Type inference (for use elsewhere)
export type CreateOrderBody = z.infer<typeof createOrderSchema>;
export type CreateOrderItem = z.infer<typeof orderItemSchema>;
export type Address = z.infer<typeof addressSchema>;

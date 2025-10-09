import { Request } from "express";
import { th } from "zod/v4/locales";

// Types for request body
interface CreateOrderItem {
  productId: string;
  variantId?: string | null;
  quantity: number;
}

interface CreateOrderBody {
  vendorId: string;
  items: CreateOrderItem[];
  deliveryAddress: {
    street?: string;
    city?: string;
    state?: string;
    lga?: string;
    postalCode?: string;
    country?: string;
  };
  paymentMethod: "PAYSTACK" | "CASH_ON_DELIVERY";
  // placeId is an external map/place identifier (used for geolocation and tracking)
  placeId: string;
}

const validateCreateOrderBody = (body: any): CreateOrderBody => {
  const { vendorId, items, deliveryAddress, paymentMethod, placeId } = body;

  // Require external place id (string) for map tracking and a deliveryAddress object
  if (!placeId || typeof placeId !== "string" || placeId.trim().length === 0) {
    throw new Error("placeId is required and must be a non-empty string");
  }
  // Check required fields
  if (!vendorId || !items || !deliveryAddress || !paymentMethod) {
    throw new Error("Missing required fields");
  }

  // Validate vendorId
  if (typeof vendorId !== "string") {
    throw new Error("vendorId is required and must be a string.");
  }

  // Validate items array
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("items array is required and must not be empty.");
  }

  for (const item of items) {
    if (!item.productId || typeof item.productId !== "string") {
      throw new Error("Each item must have a valid productId.");
    }
    if (
      !item.quantity ||
      typeof item.quantity !== "number" ||
      item.quantity <= 0
    ) {
      throw new Error("Each item must have a quantity greater than 0.");
    }
    if (item.variantId && typeof item.variantId !== "string") {
      throw new Error("variantId must be a string if provided.");
    }
  }

  // Validate delivery address (only required fields based on your schema)
  if (!deliveryAddress || typeof deliveryAddress !== "object") {
    throw new Error("Invalid delivery address format.");
  }

  // Ensure formatted address field exists for Prisma Address.address (required)
  if (
    !deliveryAddress.address ||
    typeof deliveryAddress.address !== "string" ||
    deliveryAddress.address.trim().length === 0
  ) {
    throw new Error(
      "deliveryAddress.address is required and must be a non-empty string"
    );
  }

  // Note: Based on your Address type, all fields are optional except country has a default
  // Adjust validation based on your business requirements

  // Validate payment method
  if (!["PAYSTACK", "CASH_ON_DELIVERY"].includes(paymentMethod)) {
    throw new Error("Invalid payment method.");
  }

  return { vendorId, items, deliveryAddress, paymentMethod, placeId };
};

// Helper function to calculate order total
const calculateOrderTotal = async (
  items: CreateOrderItem[]
): Promise<number> => {
  let total = 0;

  for (const item of items) {
    // Get product price (or variant price if variant is specified)
    const product = await prisma?.product.findUnique({
      where: { id: item.productId },
      include: {
        variants: item.variantId
          ? {
              where: { id: item.variantId },
            }
          : false,
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

// Helper function to get customer ID from request (adjust based on your auth system)
const getCustomerIdFromRequest = (req: Request): string => {
  // This should be extracted from your authentication middleware
  // Example: return req.user.id;
  // For now, assuming it's passed in the request body or headers
  const customerId = req.user?.sub || req.headers["customer-id"];
  if (!customerId) {
    throw new Error("Customer ID is required");
  }
  return customerId as string;
};

export {
  calculateOrderTotal,
  getCustomerIdFromRequest,
  validateCreateOrderBody,
};

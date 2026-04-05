import { AppError } from "@lib/utils/AppError";
import z from "zod";

// ----- Helper: Auth helper (lightweight) -----
// Replace this with your real implementation if you already have it.
function getVendorIdFromRequest(req: Request): string {
  // Expecting middleware to have set req.user or similar. Adjust to your auth shape.
  // If you have a JWT middleware that sets req.user = { id: '...' }, use that.
  // For safety, this throws if vendor id is missing.
  const anyReq = req as any;
  const vendorId = anyReq?.user?.id || anyReq?.vendorId || anyReq?.vendor?.id;
  if (!vendorId || typeof vendorId !== "string") {
    throw new AppError(401, "Authentication required: vendor id not found");
  }
  return vendorId;
}

// ----- Validation helpers (simple, no external deps) -----
function isValidObjectId(id: unknown): id is string {
  return typeof id === "string" && id.trim().length > 0; // assume string ObjectId; validate format in app if needed
}

function coerceNumber(value: any): number | null {
  if (typeof value === "number" && !Number.isNaN(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

function validateCreateProduct(body: any) {
  const errors: { field: string; message: string }[] = [];
  const out: any = {};

  if (!body || typeof body !== "object") {
    throw new AppError(400, "Invalid request body");
  }

  // name
  if (
    !body.name ||
    typeof body.name !== "string" ||
    body.name.trim().length < 2
  ) {
    errors.push({
      field: "name",
      message: "Product name is required (2+ chars)",
    });
  } else {
    out.name = body.name.trim();
  }

  // description (optional)
  if (body.description !== undefined) {
    if (typeof body.description !== "string") {
      errors.push({
        field: "description",
        message: "Description must be a string",
      });
    } else {
      out.description = body.description.trim();
    }
  }

  // basePrice
  const basePrice = coerceNumber(body.basePrice);
  if (basePrice === null || basePrice <= 0) {
    errors.push({
      field: "basePrice",
      message: "basePrice is required and must be a positive number",
    });
  } else {
    out.basePrice = basePrice;
  }

  // sku (optional)
  if (body.sku !== undefined) {
    if (typeof body.sku !== "string")
      errors.push({ field: "sku", message: "sku must be a string" });
    else out.sku = body.sku.trim();
  }

  // attributes (optional) - expect object or JSON
  if (body.attributes !== undefined) {
    if (typeof body.attributes !== "object")
      errors.push({
        field: "attributes",
        message: "attributes must be a JSON object",
      });
    else out.attributes = body.attributes;
  }

  // isAvailable (optional)
  if (body.isAvailable !== undefined) {
    out.isAvailable = Boolean(body.isAvailable);
  } else {
    out.isAvailable = true;
  }

  // variants (optional)
  if (body.variants !== undefined) {
    if (!Array.isArray(body.variants)) {
      errors.push({ field: "variants", message: "variants must be an array" });
    } else {
      out.variants = [];
      body.variants.forEach((v: any, idx: number) => {
        const vErrors: string[] = [];
        if (!v || typeof v !== "object") {
          vErrors.push("invalid variant object");
        } else {
          if (
            !v.name ||
            typeof v.name !== "string" ||
            v.name.trim().length === 0
          )
            vErrors.push("name required");
          const price = coerceNumber(v.price);
          if (price === null || price <= 0)
            vErrors.push("price required and must be > 0");
        }
        if (vErrors.length)
          errors.push({
            field: `variants[${idx}]`,
            message: vErrors.join(", "),
          });
        else
          out.variants.push({
            name: v.name.trim(),
            price: coerceNumber(v.price),
            attributes: v.attributes || {},
            stock: Number.isInteger(v.stock) ? v.stock : undefined,
            isAvailable:
              v.isAvailable === undefined ? true : Boolean(v.isAvailable),
          });
      });
    }
  }

  if (errors.length) throw new AppError(400, "Validation failed", { errors });
  return out;
}

function validateUpdateProduct(body: any) {
  if (!body || typeof body !== "object")
    throw new AppError(400, "Invalid request body");
  const errors: { field: string; message: string }[] = [];
  const out: any = {};

  // Accept any of the create fields but all optional
  if (body.name !== undefined) {
    if (typeof body.name !== "string" || body.name.trim().length < 2)
      errors.push({ field: "name", message: "name must be 2+ chars" });
    else out.name = body.name.trim();
  }

  if (body.description !== undefined) {
    if (typeof body.description !== "string")
      errors.push({
        field: "description",
        message: "description must be string",
      });
    else out.description = body.description.trim();
  }

  if (body.basePrice !== undefined) {
    const basePrice = coerceNumber(body.basePrice);
    if (basePrice === null || basePrice <= 0)
      errors.push({
        field: "basePrice",
        message: "basePrice must be a positive number",
      });
    else out.basePrice = basePrice;
  }

  if (body.sku !== undefined) {
    if (typeof body.sku !== "string")
      errors.push({ field: "sku", message: "sku must be a string" });
    else out.sku = body.sku.trim();
  }

  if (body.attributes !== undefined) {
    if (typeof body.attributes !== "object")
      errors.push({
        field: "attributes",
        message: "attributes must be object",
      });
    else out.attributes = body.attributes;
  }

  if (body.isAvailable !== undefined)
    out.isAvailable = Boolean(body.isAvailable);

  if (errors.length) throw new AppError(400, "Validation failed", { errors });
  return out;
}

// Helper for 'basePrice' to handle string inputs (e.g., from form data)
const positiveNumberSchema = z.preprocess(
  (val) =>
    val === null || val === undefined || val === ""
      ? val
      : z.coerce.number().safeParse(val).success
        ? z.coerce.number().parse(val)
        : val,
  z
    .number("basePrice must be a number and Required")
    .positive("basePrice must be a positive number"),
);

const variantSchema = z.object({
  name: z.string().trim().min(1, "name required"),
  price: positiveNumberSchema.refine(
    (val) => val > 0,
    "price required and must be > 0",
  ),
  attributes: z.record(z.any(), z.any()).optional().default({}),
  stock: z.number().int().nonnegative().optional(),
  isAvailable: z.boolean().optional().default(true),
});

// ---
// ## Create Product Schema
// ---
export const createProductSchema = z.object({
  name: z.string().trim().min(2, "Product name is required (2+ chars)"),
  description: z.string().trim().optional(),
  basePrice: positiveNumberSchema,
  sku: z.string().trim().optional(),
  imageUrl: z.string().url("Invalid image URL").optional(),
  attributes: z.record(z.any(), z.any()).optional(),
  isAvailable: z.boolean().optional().default(false),
  variants: z.array(variantSchema).optional(),
});

// ---
// ## Update Product Schema
// ---
export const updateProductSchema = z.object({
  name: z.string().trim().min(2, "name must be 2+ chars").optional(),
  description: z.string().trim().optional(),
  basePrice: positiveNumberSchema.optional(),
  sku: z.string().trim().optional(),
  imageUrl: z.string().url("Invalid image URL").optional(),
  attributes: z.record(z.any(), z.any()).optional(),
});

// ===============================
// MODIFIER SCHEMAS (MVP)
// ===============================

export const createModifierGroupSchema = z
  .object({
    name: z.string().min(2, "Name must be at least 2 characters"),
    isRequired: z.boolean().default(false),
    minSelect: z.number().int().min(0).default(0),
    maxSelect: z.number().int().min(1).default(1),
    options: z
      .array(
        z.object({
          name: z.string().min(1, "Option name required"),
          priceAdjustment: z.number().default(0),
        }),
      )
      .min(1, "At least one option required"),
  })
  .refine((data) => data.maxSelect >= data.minSelect, {
    message: "maxSelect must be >= minSelect",
  });

export const updateModifierGroupSchema = z.object({
  name: z.string().min(2).optional(),
  isRequired: z.boolean().optional(),
  minSelect: z.number().int().min(0).optional(),
  maxSelect: z.number().int().min(1).optional(),
});

export const createModifierOptionSchema = z.object({
  name: z.string().min(1, "Option name required"),
  priceAdjustment: z.number().default(0),
});

export const updateModifierOptionSchema = z.object({
  name: z.string().min(1).optional(),
  priceAdjustment: z.number().optional(),
  isAvailable: z.boolean().optional(),
});

// ===============================
// ORDER WITH MODIFIERS SCHEMA
// ===============================

export const orderItemWithModifiersSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().optional(),
  quantity: z.number().int().min(1).default(1),
  modifiers: z
    .array(
      z.object({
        modifierGroupId: z.string(),
        selectedOptions: z
          .array(
            z.object({
              modifierOptionId: z.string(),
              quantity: z.number().int().min(1).default(1),
            }),
          )
          .min(1),
      }),
    )
    .optional(),
});

// Update existing createOrderSchema
export const createOrderSchemaWithModifiers = z.object({
  vendorId: z.string().min(1),
  items: z.array(orderItemWithModifiersSchema).min(1),
  contactInfo: z.object({
    fullName: z.string().min(2),
    phone: z.string().min(10),
    email: z.email(),
    instructions: z.string().optional(),
  }),
  deliveryAddress: z.object({
    address: z.string().min(5),
    state: z.string().optional(),
    country: z.string().optional(),
    coordinates: z
      .object({
        lat: z.number(),
        long: z.number(),
      })
      .optional(),
  }),
  paymentMethod: z.enum(["PAYSTACK", "CASH_ON_DELIVERY"]),
});

export {
  coerceNumber,
  getVendorIdFromRequest,
  isValidObjectId,
  validateCreateProduct,
  validateUpdateProduct,
};

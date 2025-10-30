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

export const createProductSchema = z.object({
  name: z.string().nonempty().min(2),
  description: z.string().optional(),
  basePrice: z.number().positive(),
  sku: z.string().optional(),
  attributes: z.record(z.any(), z.any()).optional(),
  isAvailable: z.boolean().optional(),
  variants: z
    .array(
      z.object({
        name: z.string().nonempty(),
        price: z.number().positive(),
        attributes: z.record(z.any(), z.any()).optional(),
        stock: z.number().int().nonnegative().optional(),
        isAvailable: z.boolean().optional(),
      })
    )
    .optional(),
});

export const updateProductSchema = z.object({
  name: z.string().min(2).optional(),
  description: z.string().optional(),
  basePrice: z.number().positive().optional(),
  sku: z.string().optional(),
  attributes: z.record(z.any(), z.any()).optional(),
  isAvailable: z.boolean().optional(),
});

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

export {
  coerceNumber,
  getVendorIdFromRequest,
  isValidObjectId,
  validateCreateProduct,
  validateUpdateProduct,
};

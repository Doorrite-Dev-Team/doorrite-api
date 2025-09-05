import { AppError } from "@lib/utils/AppError";
import { Request } from "express";

// // Helper function to get vendor ID from JWT token
// const getVendorIdFromRequest = (req: Request): string => {
//   // This should extract vendorId from your JWT payload
//   // Adjust based on your auth middleware implementation
//   const vendorId = (req as any).vendor?.id || req.headers["vendor-id"];
//   if (!vendorId) {
//     throw new AppError(401, "Vendor authentication required");
//   }
//   return vendorId as string;
// };

// // Validation helpers
// const validateCreateProduct = (body: any): CreateProductBody => {
//   const { name, basePrice, categoryId } = body;

//   if (!name || typeof name !== "string" || name.trim().length === 0) {
//     throw new AppError(400, "Product name is required");
//   }

//   if (!basePrice || typeof basePrice !== "number" || basePrice <= 0) {
//     throw new AppError(400, "Valid base price is required");
//   }

//   if (!categoryId || typeof categoryId !== "string") {
//     throw new AppError(400, "Category ID is required");
//   }

//   // Validate variants if provided
//   if (body.variants && Array.isArray(body.variants)) {
//     for (const variant of body.variants) {
//       if (!variant.name || typeof variant.name !== "string") {
//         throw new AppError(400, "Variant name is required");
//       }
//       if (
//         !variant.price ||
//         typeof variant.price !== "number" ||
//         variant.price <= 0
//       ) {
//         throw new AppError(400, "Valid variant price is required");
//       }
//     }
//   }

//   return body;
// };

// const validateUpdateProduct = (body: any): UpdateProductBody => {
//   if (
//     body.basePrice !== undefined &&
//     (typeof body.basePrice !== "number" || body.basePrice <= 0)
//   ) {
//     throw new AppError(400, "Valid base price is required");
//   }

//   if (
//     body.name !== undefined &&
//     (typeof body.name !== "string" || body.name.trim().length === 0)
//   ) {
//     throw new AppError(400, "Valid product name is required");
//   }

//   return body;
// };

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


export { coerceNumber, getVendorIdFromRequest, isValidObjectId };


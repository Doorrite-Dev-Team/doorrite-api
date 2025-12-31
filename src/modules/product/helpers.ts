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

// Helper function to build price filter based on Nigerian market
const buildPriceFilter = (price: string) => {
  // Handle exact price with tolerance
  const priceNum = coerceNumber(price.replace(/[^0-9.]/g, ""));
  if (priceNum !== null && priceNum >= 0) {
    return {
      basePrice: {
        gte: Math.max(0, priceNum - 1000),
        lte: priceNum + 1000,
      },
    };
  }

  // Handle price ranges (e.g., "0-1000", "1000-5000")
  const rangeMatch = price.match(/^(\d+)-(\d+)$/);
  if (rangeMatch) {
    const [, min, max] = rangeMatch;
    return {
      basePrice: {
        gte: parseInt(min, 10),
        lte: parseInt(max, 10),
      },
    };
  }

  return null;
};

// Helper function to build sort order
const buildSortOrder = (
  sort: string,
  userLocation?: { lat: number; lng: number },
) => {
  switch (sort) {
    case "price-low":
      return { basePrice: "asc" };
    case "price-high":
      return { basePrice: "desc" };
    case "newest":
      return { createdAt: "desc" };
    case "popular":
      return [{ orderCount: "desc" }, { rating: "desc" }];
    case "rating":
      return { rating: "desc" };
    case "distance":
      // TODO: Implement geospatial sorting when location data is available
      // For now, fallback to createdAt
      return { createdAt: "desc" };
    default:
      return { createdAt: "desc" };
  }
};

const isVendorOpen = (
  openingTime: string | null,
  closingTime: string | null,
): boolean => {
  if (!openingTime || !closingTime) return true; // Default to open if times aren't set

  try {
    const now = new Date();
    const parseTime = (timeStr: string) => {
      const [time, modifier] = timeStr.split(" ");
      let [hours, minutes] = time.split(":").map(Number);
      if (modifier === "PM" && hours < 12) hours += 12;
      if (modifier === "AM" && hours === 12) hours = 0;
      const date = new Date();
      date.setHours(hours, minutes, 0, 0);
      return date;
    };

    const start = parseTime(openingTime);
    const end = parseTime(closingTime);
    return now >= start && now <= end;
  } catch (e) {
    return true; // Fail safe
  }
};

const getPaginationParams = (page?: string, limit?: string) => {
  const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
  const limitNum = Math.min(
    100,
    Math.max(1, parseInt(String(limit), 10) || 20),
  );
  return { pageNum, limitNum };
};

export {
  coerceNumber,
  getVendorIdFromRequest,
  isValidObjectId,
  validateCreateProduct,
  validateUpdateProduct,
  getPaginationParams,
  buildPriceFilter,
  buildSortOrder,
  isVendorOpen,
};

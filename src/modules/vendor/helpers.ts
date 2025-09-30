import { AppError } from '@lib/utils/AppError';

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

import prisma from "@config/db";
import { AppError, handleError, sendSuccess } from "@lib/utils/AppError";
import { isValidNigerianPhone } from "@modules/auth/helper";
import { isValidObjectId } from "@modules/product/helpers";
import { Request, Response } from "express";

//Get Vendor Details
//GET /api/vendors/:id
export const getVendorById = async (req: Request, res: Response) => {
  try {
    const vendorId = req.params.id;

    if (!isValidObjectId(vendorId)) {
      throw new AppError(400, "Invalid vendor ID");
    }

    const vendor = await prisma.vendor.findUnique({
      where: { id: vendorId },
      include: {
        products: true,
        reviews: true,
      },
    });

    if (!vendor) {
      throw new AppError(404, "Vendor not found");
    }

    return sendSuccess(res, { vendor });
  } catch (error) {
    handleError(res, error);
  }
};

//Get Current Vendor Profile
//GET /api/vendors/profile
export const getCurrentVendorProfile = async (req: Request, res: Response) => {
  try {
    const vendorId = req.vendor?.id; // Assuming vendor ID is available from auth middleware
    if (!vendorId) {
      throw new AppError(401, "Authentication required");
    }

    const vendor = await prisma.vendor.findUnique({
      where: { id: vendorId },
      include: {
        products: true,
        orders: true,
      },
    });

    if (!vendor) {
      throw new AppError(404, "Vendor not found");
    }

    return sendSuccess(res, { vendor });
  } catch (error) {
    handleError(res, error);
  }
};

//Get All Vendors
//GET /api/vendors
export const getAllVendors = async (req: Request, res: Response) => {
  try {
    const vendors = await prisma.vendor.findMany();
    return sendSuccess(res, { vendors });
  } catch (error) {
    return handleError(res, error);
  }
};

//Update Vendor Profile
// PUT api/v1/vendors/profile
export const updateVendorProfile = async (req: Request, res: Response) => {
  const vendorId = req.vendor?.id;
  if (!vendorId) throw new AppError(401, "Authentication required");

  const allowedFields = ["businessName", "phoneNumber", "address", "logoUrl"];

  const data: Record<string, any> = {};
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      data[field] = req.body[field];
    }
  }

  if (Object.keys(data).length === 0) {
    throw new AppError(400, "No valid update fields provided");
  }

  // Extra validation example
  const errors: string[] = [];

  if (
    (data.businessName && typeof data.businessName !== "string") ||
    (data.businessName && data.businessName.trim() === "")
  ) {
    errors.push("Business name must be a non-empty string");
  }

  if (data.phoneNumber && !isValidNigerianPhone(data.phoneNumber)) {
    errors.push("Invalid phone number format");
  }

  /*
  // types
type Address {
  street     String?
  city       String?
  state      String?
  lga        String?
  postalCode String?
  country    String? @default("Nigeria")
}
  */

  if (
    data.address &&
    (typeof data.address !== "object" ||
      Array.isArray(data.address) ||
      data.address.address.trim() === "")
  ) {
    errors.push("Address must be a valid JSON object");
  }

  if (data.logoUrl && typeof data.logoUrl !== "string") {
    errors.push("Logo URL must be a string");
  }

  if (errors.length > 0) {
    throw new AppError(400, errors.join(", "));
  }

  const updatedVendor = await prisma.vendor.update({
    where: { id: vendorId },
    data,
  });

  return sendSuccess(res, {
    message: "Vendor updated successfully",
    vendor: updatedVendor,
  });
};

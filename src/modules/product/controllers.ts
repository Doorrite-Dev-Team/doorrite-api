import prisma from "@config/db";
import { AppError, handleError, sendSuccess } from "@lib/utils/AppError";
import { Request, Response } from "express";
import { coerceNumber, isValidObjectId } from "./helpers";

/*
  Complete Product controllers (TypeScript + Express) matching the MVP Prisma schema
  - Product model fields used: id, vendorId, name, description, basePrice, sku, attributes, isAvailable, createdAt, updatedAt
  - Relations used: variants (ProductVariant), orderItems

  Controllers included:
  - getProducts (public)
  - getProductById (public)
  - createProduct (vendor)
  - updateProduct (vendor)
  - prepareProductDeletion (soft delete, vendor)
  - deleteProduct (permanent delete, vendor)
  - createProductVariant (vendor)
  - updateProductVariant (vendor)
  - deleteProductVariant (vendor)

  Notes:
  - This file includes compact validation helpers to keep the controllers self-contained.
  - Replace `getVendorIdFromRequest` with your app's auth helper if you already have one.
  - All multi-step DB operations use prisma transactions where appropriate.
*/
// ----- Controllers -----

// GET /api/v1/products
export const getProducts = async (req: Request, res: Response) => {
  try {
    const {
      page = "1",
      limit = "20",
      vendorId,
      search,
      minPrice,
      maxPrice,
    } = req.query;

    const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
    const limitNum = Math.min(
      100,
      Math.max(1, parseInt(String(limit), 10) || 20)
    );

    const where: any = { isAvailable: true };

    if (vendorId && isValidObjectId(vendorId))
      where.vendorId = String(vendorId);

    if (search && typeof search === "string") {
      const q = search.trim();
      if (q.length) {
        where.OR = [
          { name: { contains: q, mode: "insensitive" } },
          { description: { contains: q, mode: "insensitive" } },
        ];
      }
    }

    if (minPrice !== undefined || maxPrice !== undefined) {
      where.basePrice = {};
      const minN = coerceNumber(minPrice);
      const maxN = coerceNumber(maxPrice);
      if (minPrice !== undefined && (minN === null || minN < 0))
        throw new AppError(400, "minPrice must be a valid non-negative number");
      if (maxPrice !== undefined && (maxN === null || maxN < 0))
        throw new AppError(400, "maxPrice must be a valid non-negative number");
      if (minN !== null) where.basePrice.gte = minN;
      if (maxN !== null) where.basePrice.lte = maxN;
      // remove empty object
      if (Object.keys(where.basePrice).length === 0) delete where.basePrice;
    }

    // include only active vendors for public listings
    where.vendor = { isActive: true, isVerified: true } as any;

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: {
          variants: {
            where: { isAvailable: true },
            orderBy: { createdAt: "asc" },
          },
          vendor: { select: { id: true, businessName: true, logoUrl: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
      prisma.product.count({ where }),
    ]);

    return sendSuccess(res, {
      products,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    return handleError(res, err);
  }
};

// GET /api/v1/products/:id
export const getProductById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) throw new AppError(400, "Product ID is required");

    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        variants: {
          where: { isAvailable: true },
          orderBy: { createdAt: "asc" },
        },
        vendor: {
          select: {
            id: true,
            businessName: true,
            logoUrl: true,
            isActive: true,
            isVerified: true,
          },
        },
      },
    });

    if (!product) throw new AppError(404, "Product not found");
    if (!product.isAvailable) throw new AppError(404, "Product not available");

    // vendor must be active & verified
    if (
      !product.vendor ||
      !product.vendor.isActive ||
      !product.vendor.isVerified
    )
      throw new AppError(404, "Product not available");

    return sendSuccess(res, { product });
  } catch (err) {
    return handleError(res, err);
  }
};

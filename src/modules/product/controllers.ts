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

// GET /api/v1/products/?page=&limit=&vendorId=&search=&minPrice=&maxPrice=
export const getProducts = async (req: Request, res: Response) => {
  try {
    const {
      page = "1",
      limit = "20",
      q,
      category,
      sort,
      price,
      open,
    } = req.query;

    const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
    const limitNum = Math.min(
      100,
      Math.max(1, parseInt(String(limit), 10) || 20)
    );

    const where: any = { isAvailable: true };

    // Search by name or description
    if (q && typeof q === "string" && q.trim().length) {
      where.OR = [
        { name: { contains: q.trim(), mode: "insensitive" } },
        { description: { contains: q.trim(), mode: "insensitive" } },
      ];
    }

    // Filter by category
    if (category && typeof category === "string" && category.trim().length) {
      where.category = category.trim();
    }

    // Filter by price (Nigeria: find food closer to the price ±1000 NGN)
    if (price && typeof price === "string") {
      const priceNum = coerceNumber(price.replace(/[^0-9.]/g, ""));
      if (priceNum !== null && priceNum >= 0) {
        where.basePrice = {
          gte: priceNum - 1000 >= 0 ? priceNum - 1000 : 0,
          lte: priceNum + 1000,
        };
      }
    }

    // Filter by open vendors
    if (open === "true") {
      where.vendor = { isActive: true, isVerified: true };
    }

    // Sorting
    let orderBy: any = { createdAt: "desc" };
    if (sort === "distance") {
      // Placeholder: sort by vendor's distance if available (requires geo data)
      // orderBy = { vendor: { distance: "asc" } }; // Needs implementation
    } else if (sort === "price") {
      orderBy = { basePrice: "asc" };
    }

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
        orderBy,
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

// GET /api/v1/products/:productId
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

// GET /products/:productId/variants
export const getProductVariants = async (req: Request, res: Response) => {
  try {
    const { productId } = req.params;
    if (!isValidObjectId(productId)) {
      throw new AppError(400, "Valid product ID is required");
    }
    const variants = await prisma.productVariant.findMany({
      where: { productId, isAvailable: true },
      orderBy: { createdAt: "asc" },
    });
    return sendSuccess(res, { variants });
  } catch (error) {
    handleError(res, error);
  }
};

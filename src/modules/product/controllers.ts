import { AppError, handleError, sendSuccess } from "@lib/utils/AppError";
import { Request, Response } from "express";
import { coerceNumber, isValidObjectId } from "./helpers";
import prisma from "@config/db";
import {
  calculateDeliveryTime,
  calculateDeliveryFee,
  calculateIsOpen,
  calculateDistance,
} from "@lib/utils/location";

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

// GET /api/v1/products/?q=&lat=&lng=
export const getProducts = async (req: Request, res: Response) => {
  try {
    const { q, lat, lng } = req.query;

    if (!q || typeof q !== "string" || q.trim().length < 2) {
      throw new AppError(400, "Search query must be at least 2 characters");
    }

    const userLat = lat ? parseFloat(String(lat)) : undefined;
    const userLng = lng ? parseFloat(String(lng)) : undefined;

    const products = await prisma.product.findMany({
      where: {
        isAvailable: true,
        OR: [
          { name: { contains: q.trim(), mode: "insensitive" } },
          { description: { contains: q.trim(), mode: "insensitive" } },
        ],
        vendor: {
          isActive: true,
          isVerified: true,
          isApproved: true,
        },
      },
      include: {
        vendor: {
          select: {
            id: true,
            businessName: true,
            logoUrl: true,
            rating: true,
            avrgPreparationTime: true,
            openingTime: true,
            closingTime: true,
            address: true,
            categories: true,
          },
        },
        variants: {
          where: { isAvailable: true },
          select: { id: true, name: true, price: true },
          take: 3,
        },
      },
      take: 50,
    });

    const vendorMap = new Map<string, any>();

    products.forEach((product) => {
      const vendorId = product.vendor.id;

      if (!vendorMap.has(vendorId)) {
        const isOpen = calculateIsOpen(
          product.vendor.openingTime || undefined,
          product.vendor.closingTime || undefined,
        );
        const deliveryTime = calculateDeliveryTime(
          product.vendor.avrgPreparationTime || undefined,
          userLat,
          userLng,
          product.vendor.address,
        );
        const deliveryFee = calculateDeliveryFee(
          product.vendor,
          userLat,
          userLng,
        );
        const distance =
          userLat &&
          userLng &&
          product.vendor.address?.coordinates?.lat &&
          product.vendor.address?.coordinates?.long
            ? calculateDistance(
                userLat,
                userLng,
                product.vendor.address.coordinates.lat,
                product.vendor.address.coordinates.long,
              )
            : undefined;

        vendorMap.set(vendorId, {
          vendor: {
            id: product.vendor.id,
            businessName: product.vendor.businessName,
            logoUrl: product.vendor.logoUrl,
            cuisine: product.vendor.categories,
            rating: product.vendor.rating || 0,
            deliveryTime,
            deliveryFee,
            isOpen,
            distance,
          },
          products: [],
          matchCount: 0,
        });
      }

      const vendorData = vendorMap.get(vendorId);
      vendorData.products.push({
        id: product.id,
        name: product.name,
        description: product.description,
        basePrice: product.basePrice,
        variants: product.variants,
      });
      vendorData.matchCount++;
    });

    const groupedResults = Array.from(vendorMap.values()).sort(
      (a: any, b: any) => b.matchCount - a.matchCount,
    );

    const data = {
      query: q,
      groupedResults,
      totalVendors: groupedResults.length,
      totalProducts: products.length,
    };

    console.log(data);

    return sendSuccess(res, data);
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

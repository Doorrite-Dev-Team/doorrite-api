import { AppError, handleError, sendSuccess } from "@lib/utils/AppError";
import { Request, Response } from "express";
import {
  coerceNumber,
  getPaginationParams,
  isValidObjectId,
  isVendorOpen,
} from "./helpers";
import prisma from "@config/db";
import type { Product } from "../../generated/prisma/client";

/*
  Complete Product controllers (TypeScript + Express) matching the MVP prisma schema
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
/*
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
      Math.max(1, parseInt(String(limit), 10) || 20),
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

export const getProducts = async (req: Request, res: Response) => {
  try {
    const {
      page = "1",
      limit = "20",
      q,
      category,
      sort = "newest",
      price,
      minPrice,
      maxPrice,
      open,
      vendorId,
      minRating,
    } = req.query;

    // 1. Unified Pagination Parsing
    const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(String(limit), 10) || 20));

    // 2. Build the "Where" Clause
    const where: any = { isAvailable: true };

    // Search (Name, Description, and Category)
    if (q && typeof q === "string" && q.trim().length > 0) {
      const searchTerm = q.trim();
      where.OR = [
        { name: { contains: searchTerm, mode: "insensitive" } },
        { description: { contains: searchTerm, mode: "insensitive" } },
        { attributes: { path: ["tags"], array_contains: searchTerm.toLowerCase() } }, // MongoDB Json/Array tag support
      ];
    }

    // Filters
    if (category && typeof category === "string") {
      where.name = { contains: category.trim(), mode: "insensitive" };
      // Note: If you add a dedicated 'category' field to Product model, use that instead.
    }

    if (vendorId && typeof vendorId === "string") {
      where.vendorId = vendorId;
    }

    // Harmonized Price Logic
    if (price || minPrice || maxPrice) {
      where.basePrice = {};
      if (price) {
        // V1 Logic: ±1000 NGN range for a specific price point
        const p = parseFloat(String(price).replace(/[^0-9.]/g, ""));
        where.basePrice.gte = Math.max(0, p - 1000);
        where.basePrice.lte = p + 1000;
      } else {
        // V2 Logic: Specific range
        if (minPrice) where.basePrice.gte = parseFloat(String(minPrice));
        if (maxPrice) where.basePrice.lte = parseFloat(String(maxPrice));
      }
    }

    // Vendor Status Filter
    if (open === "true") {
      where.vendor = {
        isActive: true,
        isVerified: true,
      };
    }

    // 3. Sorting Logic
    let orderBy: any = { createdAt: "desc" }; // Default: Newest
    if (sort === "price_low") orderBy = { basePrice: "asc" };
    if (sort === "price_high") orderBy = { basePrice: "desc" };
    if (sort === "popular") orderBy = { orderItems: { _count: "desc" } };

    // 4. Execution
    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: {
          variants: {
            where: { isAvailable: true },
            orderBy: { price: "asc" },
            take: 5,
          },
          vendor: {
            select: {
              id: true,
              businessName: true,
              logoUrl: true,
              rating: true,
              isActive: true,
              openingTime: true,
              closingTime: true,
            },
          },
          _count: {
            select: {
              reviews: true,
              orderItems: true,
            },
          },
        },
        orderBy,
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
      prisma.product.count({ where }),
    ]);

    // 5. Enhance Data with Computed Fields
    const enhancedProducts = products.map((product) => {
      // Calculate average rating from related reviews if needed
      // or use the vendor's rating as a proxy
      const lowestPrice = product.variants.length > 0
        ? Math.min(...product.variants.map(v => v.price))
        : product.basePrice;

      return {
        ...product,
        lowestPrice,
        reviewCount: product._count.reviews,
        orderCount: product._count.orderItems,
        _count: undefined, // Remove raw count object from response
      };
    });

    return sendSuccess(res, {
      products: enhancedProducts,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
        hasNext: pageNum * limitNum < total,
      },
      filters: {
        q: q || null,
        category: category || null,
        vendorId: vendorId || null,
      }
    });
  } catch (err) {
    return handleError(res, err);
  }
};
*/

/**
 * GET /api/v1/products
 * Optimized for MongoDB limitations:
 * - Uses Vendor rating as proxy for list sorting (Product rating requires aggregation pipeline)
 * - Safely handles JSON filter for 'category'
 */
export const getProducts = async (req: Request, res: Response) => {
  try {
    const {
      page,
      limit,
      q,
      // category,
      sort = "popular",
      price,
      open,
      vendorId,
      minRating,
    } = req.query;

    const { pageNum, limitNum } = getPaginationParams(
      page as string,
      limit as string,
    );

    // 1. Build Where Clause
    const where: any = {
      isAvailable: true,
      vendor: {
        isActive: true, // Only show active vendors
        isApproved: true,
      },
    };

    // Search (Name or Description)
    if (q && typeof q === "string") {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
      ];
    }

    // Filter by Category (Checking inside JSON attributes as fallback)
    // if (category && typeof category === "string") {
    //   // Note: MongoDB prisma JSON filtering is limited.
    //   // We assume attributes looks like { "category": "Food" }
    //   where.attributes = {
    //     path: ["category"],
    //     equals: category,
    //   };
    // }

    if (vendorId && typeof vendorId === "string") where.vendorId = vendorId;

    // Price Filter
    if (price && typeof price === "string") {
      // 1. Remove commas and whitespace, but keep hyphens for ranges
      const cleanPrice = price.replace(/,/g, "").trim();

      // Handle Range: "0-1000" or "1000-2000"
      if (cleanPrice.includes("-")) {
        const [minStr, maxStr] = cleanPrice.split("-");
        const min = coerceNumber(minStr.replace(/[^0-9.]/g, ""));
        const max = coerceNumber(maxStr.replace(/[^0-9.]/g, ""));

        if (min !== undefined && max !== undefined) {
          where.basePrice = {
            gte: min,
            lte: max,
          };
        }
      }
      // Handle Single Value: "50000" (meaning 50k and above)
      else {
        const priceNum = coerceNumber(cleanPrice.replace(/[^0-9.]/g, ""));

        if (priceNum) {
          // Logic: If user enters 50,000, they usually want 50k+ in a listing context
          // If you still want the +/- 500 buffer for small numbers,
          // you can add a check: if (priceNum < 5000)
          where.basePrice = {
            gte: priceNum,
            // Remove 'lte' to allow "50k and above"
          };
        }
      }
    }

    // Min Rating (Filtering by Vendor Rating as proxy for performance)
    if (minRating) {
      const rating = parseFloat(minRating as string);
      if (!isNaN(rating)) {
        where.vendor = { ...where.vendor, rating: { gte: rating } };
      }
    }

    // 2. Build Sort Order
    // Note: specific product rating sort is expensive (requires aggregation).
    // We default to orderCount (popularity) or vendor rating.
    let orderBy: any = { createdAt: "desc" };

    switch (sort) {
      case "price-low":
        orderBy = { basePrice: "asc" };
        break;
      case "price-high":
        orderBy = { basePrice: "desc" };
        break;
      case "newest":
        orderBy = { createdAt: "desc" };
        break;
      case "rating":
        orderBy = { vendor: { rating: "desc" } };
        break; // Proxy sort
      case "popular":
        orderBy = { orderItems: { _count: "desc" } };
        break;
    }

    // 3. Execute Query
    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        orderBy,
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
        include: {
          variants: {
            where: { isAvailable: true },
            take: 1, // Only need the starting price
            orderBy: { price: "asc" },
          },
          vendor: {
            select: {
              id: true,
              businessName: true,
              rating: true,
              openingTime: true,
              closingTime: true,
              avrgPreparationTime: true, // Returning as delivery estimation proxy
            },
          },
          _count: { select: { reviews: true, orderItems: true } },
        },
      }),
      prisma.product.count({ where }),
    ]);

    // 4. Post-processing (Client-side transformations)
    // We filter "open" vendors here because prisma can't easily query time strings vs Date objects
    let enhancedProducts = products.map((product) => {
      const isOpen = isVendorOpen(
        product.vendor.openingTime,
        product.vendor.closingTime,
      );

      // Calculate effective price (Variant vs Base)
      const lowestVariantPrice =
        product.variants.length > 0 ? product.variants[0].price : null;

      // declare interface Product {
      //   id: string;
      //   vendorId: string;
      //   name: string;
      //   description?: string;
      //   basePrice: number; // Prisma Float to number
      //   sku?: string;
      //   attributes?: Attributes; // Prisma Json to Record<string, any>
      //   isAvailable: boolean;
      //   imageUrl: string;

      //   // Relations (required for frontend display)
      //   variants: ProductVariant[];
      //   vendor: {
      //     // Simplified relation data for product card view
      //     id: string;
      //     businessName: string;
      //     logoUrl?: string;
      //     // isOpen?: boolean;
      //     isActive: boolean;
      //     openingTime: string;
      //     closingTime: string;
      //     address?: Address; // Derived from Vendor.address
      //   };
      // }
      return {
        ...product,
        rating: product.vendor.rating || 0, // Fallback to vendor rating
        reviewCount: product._count.reviews,
        orderCount: product._count.orderItems,
        vendor: {
          ...product.vendor,
          isOpen: isOpen,
          deliveryTime: product.vendor.avrgPreparationTime || "10-30 mins",
        },
        hasVariants: product.variants.length > 0,
      };
    });

    // Handle "Open" filter in memory (MongoDB limitation workaround)
    if (open === "true") {
      enhancedProducts = enhancedProducts.filter((p) => p.vendor.isOpen);
    }

    return sendSuccess(res, {
      products: enhancedProducts,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    console.error("❌ Error fetching products:", err);
    return handleError(res, err);
  }
};

/**
 * GET /api/v1/products/categories
 * Senior Dev Note: This is computationally expensive without a dedicated Category model or field.
 * We must aggregate on the fly.
 */
export const getProductCategories = async (_req: Request, res: Response) => {
  try {
    // Current Schema Limitation: No top-level category field.
    // Solution: If using attributes JSON, we group by that, otherwise we Mock or scan.

    // Optimized approach: Group by `attributes` is not fully supported in prisma Mongo for all structures.
    // Fallback: Return a hardcoded list of standard categories tailored to Nigerian market
    // OR fetch a distinct list if `category` field existed.

    const hardcodedCategories = [
      { name: "Rice & Pasta", value: "rice-pasta", count: 0 },
      { name: "Swallows", value: "swallows", count: 0 },
      { name: "Snacks", value: "snacks", count: 0 },
      { name: "Drinks", value: "drinks", count: 0 },
    ];

    return sendSuccess(res, { categories: hardcodedCategories });
  } catch (err) {
    return handleError(res, err);
  }
};

/**
 * GET /api/v1/products/trending
 */
export const getTrendingProducts = async (_req: Request, res: Response) => {
  try {
    const products = await prisma.product.findMany({
      where: { isAvailable: true },
      take: 10,
      orderBy: {
        orderItems: { _count: "desc" }, // Most ordered
      },
      include: {
        vendor: {
          select: {
            businessName: true,
            rating: true,
            openingTime: true,
            closingTime: true,
          },
        },
        _count: { select: { orderItems: true } },
      },
    });

    const formatted = products.map((p) => ({
      ...p,
      vendorName: p.vendor.businessName,
      isOpen: isVendorOpen(p.vendor.openingTime, p.vendor.closingTime),
    }));

    return sendSuccess(res, { products: formatted });
  } catch (err) {
    return handleError(res, err);
  }
};

/**
 * GET /api/v1/products/:id
 * Full detail fetch including calculating the ACTUAL average rating from reviews
 */
// export const getProductById = async (req: Request, res: Response) => {
//   try {
//     const { id } = req.params;

//     const product = await prisma.product.findUnique({
//       where: { id },
//       include: {
//         variants: { where: { isAvailable: true } },
//         vendor: {
//           select: {
//             id: true,
//             businessName: true,
//             logoUrl: true,
//             rating: true, // Vendor generic rating
//             openingTime: true,
//             closingTime: true,
//             avrgPreparationTime: true,
//             address: true,
//             phoneNumber: true,
//             isActive: true,
//           },
//         },
//         reviews: {
//           take: 5,
//           orderBy: { createdAt: "desc" },
//           include: {
//             user: {
//               select: { id: true, fullName: true, profileImageUrl: true },
//             },
//           },
//         },
//         _count: { select: { reviews: true, orderItems: true } },
//       },
//     });

//     if (!product)
//       return res
//         .status(404)
//         .json({ success: false, message: "Product not found" });

//     // Calculate Product Specific Rating (Since it's missing in Schema)
//     // We fetch all ratings for this product ID in a separate light query to get accurate average
//     const aggregations = await prisma.review.aggregate({
//       where: { productId: id },
//       _avg: { rating: true },
//       _count: { rating: true },
//     });

//     const actualRating = aggregations._avg.rating || product.vendor.rating || 0;

//     const responseData = {
//       ...product,
//       isOpen: isVendorOpen(
//         product.vendor.openingTime,
//         product.vendor.closingTime,
//       ),
//       rating: Number(actualRating.toFixed(1)), // Normalize
//       reviewCount: aggregations._count.rating,
//       deliveryTime: product.vendor.avrgPreparationTime,
//       vendor: {
//         ...product.vendor,
//         isOpen: isVendorOpen(
//           product.vendor.openingTime,
//           product.vendor.closingTime,
//         ),
//       },
//     };

//     return sendSuccess(res, { product: responseData });
//   } catch (err) {
//     return handleError(res, err);
//   }
// };

// GET /api/v1/products/:productId
export const getProductById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      throw new AppError(400, "Invalid product ID");
    }

    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        variants: {
          where: { isAvailable: true },
          orderBy: { price: "asc" },
        },
        vendor: {
          select: {
            id: true,
            businessName: true,
            logoUrl: true,
            isActive: true,
            isVerified: true,
            isApproved: true,
            avrgPreparationTime: true,
            rating: true,
            openingTime: true,
            closingTime: true,
            address: true,
            phoneNumber: true,
          },
        },
        _count: {
          select: { reviews: true, orderItems: true },
        },
      },
    });

    if (!product) {
      throw new AppError(404, "Product not found");
    }

    if (!product.isAvailable) {
      throw new AppError(410, "Product is no longer available");
    }

    if (
      !product.vendor ||
      !product.vendor.isActive ||
      !product.vendor.isApproved
    ) {
      throw new AppError(404, "Product vendor is not available");
    }

    // Calculate actual product rating from reviews
    const aggregations = await prisma.review.aggregate({
      where: { productId: id },
      _avg: { rating: true },
      _count: { rating: true },
    });

    const actualRating = aggregations._avg.rating || product.vendor.rating || 0;
    const vendorIsOpen = isVendorOpen(
      product.vendor.openingTime,
      product.vendor.closingTime,
    );

    const responseData = {
      ...product,
      rating: Number(actualRating.toFixed(1)),
      reviewCount: aggregations._count.rating,
      orderCount: product._count.orderItems,
      deliveryTime: product.vendor.avrgPreparationTime || "10-30 mins",
      hasVariants: product.variants.length > 0,
      vendor: {
        id: product.vendor.id,
        businessName: product.vendor.businessName,
        logoUrl: product.vendor.logoUrl,
        rating: product.vendor.rating,
        isActive: product.vendor.isActive,
        isVerified: product.vendor.isVerified,
        isOpen: vendorIsOpen,
        openingTime: product.vendor.openingTime,
        closingTime: product.vendor.closingTime,
        deliveryTime: product.vendor.avrgPreparationTime,
        address: product.vendor.address,
        phoneNumber: product.vendor.phoneNumber,
      },
    };

    return sendSuccess(res, { product: responseData });
  } catch (err) {
    console.error("❌ Error fetching product:", err);
    return handleError(res, err);
  }
};

// GET /products/:id/variants
export const getProductVariants = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      throw new AppError(400, "Valid product ID is required");
    }
    const variants = await prisma.productVariant.findMany({
      where: { productId: id, isAvailable: true },
      orderBy: { createdAt: "asc" },
    });
    return sendSuccess(res, { variants });
  } catch (error) {
    handleError(res, error);
  }
};

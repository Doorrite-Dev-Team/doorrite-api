import { AppError, handleError, sendSuccess } from "@lib/utils/AppError";
import { Request, Response } from "express";
import { coerceNumber, isValidObjectId } from "./helpers";
import prisma from "@config/db";
import {
  calculateDeliveryTime,
  calculateDeliveryFee,
  calculateIsOpen,
  calculateDistance,
  getGeoapifyRouting,
} from "@lib/utils/location";
import { cacheService } from "@config/cache";

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

// GET /api/v1/products/?q=&lat=&lng=&cuisine=&sort=&open=&top_rated=&page=&limit=
export const getProducts = async (req: Request, res: Response) => {
  try {
    const {
      q,
      lat,
      lng,
      cuisine,
      sort = "recommended",
      open,
      top_rated,
      page = "1",
      limit = "20",
    } = req.query;

    if (!q || typeof q !== "string" || q.trim().length < 2) {
      throw new AppError(400, "Search query must be at least 2 characters");
    }

    const userLat = lat ? parseFloat(String(lat)) : undefined;
    const userLng = lng ? parseFloat(String(lng)) : undefined;

    const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
    const limitNum = Math.min(
      100,
      Math.max(1, parseInt(String(limit), 10) || 20),
    );

    // Auto-detect user state from their saved address
    let userState: string | null = null;
    try {
      let userId: string | null = null;
      const authHeader = req.headers.authorization;
      if (authHeader) {
        const token = authHeader.split(" ")[1];
        if (token) {
          const { verifyJwt } = await import("@config/jwt");
          const payload = verifyJwt(token);
          if (payload?.sub && payload.role === "CUSTOMER") {
            userId = payload.sub;
          }
        }
      }
      if (userId) {
        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { address: true },
        });
        if (user?.address && user.address.length > 0) {
          userState = user.address[0].state;
        }
      }
    } catch {}

    // Build cache key
    const cacheKey = `products:${q}:${userState || "nostate"}:${cuisine || "none"}:${sort}:${open || "none"}:${top_rated || "none"}:${pageNum}:${limitNum}`;

    // Check cache
    const cached = await cacheService.get<any>(cacheKey);
    if (cached) {
      return sendSuccess(res, cached);
    }

    // Build where clause
    const vendorWhere: any = {
      isActive: true,
      isVerified: true,
      isApproved: true,
    };

    // Cuisine filter
    if (cuisine && typeof cuisine === "string" && cuisine !== "all") {
      vendorWhere.categories = { has: cuisine };
    }

    // Top rated filter
    if (top_rated === "true") {
      vendorWhere.rating = { gte: 4.5 };
    }

    // NOTE: State filtering is done post-fetch (like vendors endpoint)
    // because Prisma doesn't support filtering by nested address.state in MongoDB

    const products = await prisma.product.findMany({
      where: {
        isAvailable: true,
        OR: [
          { name: { contains: q.trim(), mode: "insensitive" } },
          { description: { contains: q.trim(), mode: "insensitive" } },
        ],
        vendor: vendorWhere,
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
      take: 100,
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

        const vendorProducts = products.filter((p) => p.vendor.id === vendorId);
        const prices = vendorProducts.map((p) => p.basePrice);
        const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
        const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;

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
            address: product.vendor.address,
          },
          products: [],
          matchCount: 0,
          minPrice,
          maxPrice,
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

    let groupedResults = Array.from(vendorMap.values());

    // Filter by user state (post-fetch filtering)
    if (userState) {
      groupedResults = groupedResults.filter(
        (v: any) =>
          v.vendor.address?.state?.toLowerCase() === userState.toLowerCase(),
      );
    }

    // Filter by open status
    if (open === "true") {
      groupedResults = groupedResults.filter((v: any) => v.vendor.isOpen);
    }

    // Sorting
    switch (sort) {
      case "rating":
        groupedResults.sort(
          (a: any, b: any) => b.vendor.rating - a.vendor.rating,
        );
        break;
      case "distance":
        if (userLat && userLng) {
          groupedResults.sort(
            (a: any, b: any) =>
              (a.vendor.distance || 999) - (b.vendor.distance || 999),
          );
        }
        break;
      case "price_low":
        groupedResults.sort((a: any, b: any) => a.minPrice - b.minPrice);
        break;
      case "price_high":
        groupedResults.sort((a: any, b: any) => b.maxPrice - a.maxPrice);
        break;
      case "recommended":
      default:
        groupedResults.sort((a: any, b: any) => b.matchCount - a.matchCount);
        break;
    }

    // Pagination
    const totalVendors = groupedResults.length;
    const totalPages = Math.ceil(totalVendors / limitNum);
    const skip = (pageNum - 1) * limitNum;
    const paginatedResults = groupedResults.slice(skip, skip + limitNum);

    const response: any = {
      query: q,
      groupedResults: paginatedResults,
      pagination: {
        currentPage: pageNum,
        totalPages,
        total: totalVendors,
        limit: limitNum,
      },
    };

    // Add state-specific message if no results due to state filter
    if (userState && groupedResults.length === 0) {
      response.message = `We're not yet available in ${userState}. Kindly wait for updates — we're expanding soon!`;
    } else if (paginatedResults.length === 0) {
      response.message = "No products found for your search";
    }

    // Cache results
    await cacheService.set(cacheKey, response);

    return sendSuccess(res, response);
  } catch (err) {
    return handleError(res, err);
  }
};

// GET /api/v1/products/vendor/:vendorId?exclude=productId
export const getVendorProducts = async (req: Request, res: Response) => {
  try {
    const { vendorId } = req.params;
    const { exclude } = req.query;

    if (!isValidObjectId(vendorId)) {
      throw new AppError(400, "Valid vendor ID is required");
    }

    const vendor = await prisma.vendor.findUnique({
      where: { id: vendorId },
      select: { id: true, isActive: true, isVerified: true, isApproved: true },
    });

    if (
      !vendor ||
      !vendor.isActive ||
      !vendor.isVerified ||
      !vendor.isApproved
    ) {
      throw new AppError(404, "Vendor not found or not available");
    }

    const where: any = {
      vendorId,
      isAvailable: true,
    };

    if (exclude && typeof exclude === "string" && isValidObjectId(exclude)) {
      where.id = { not: exclude };
    }

    const products = await prisma.product.findMany({
      where,
      include: {
        variants: {
          where: { isAvailable: true },
          select: { id: true, name: true, price: true },
          take: 3,
        },
      },
      take: 20,
      orderBy: { createdAt: "desc" },
    });

    return sendSuccess(res, {
      vendorId,
      products,
      total: products.length,
    });
  } catch (err) {
    return handleError(res, err);
  }
};

// GET /api/v1/products/:productId?lat=&lng=
export const getProductById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { lat, lng } = req.query;

    if (!isValidObjectId(id)) throw new AppError(400, "Product ID is required");

    const userLat = lat ? parseFloat(String(lat)) : undefined;
    const userLng = lng ? parseFloat(String(lng)) : undefined;

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
            address: true,
            openingTime: true,
            closingTime: true,
            avrgPreparationTime: true,
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

    const deliveryFee = calculateDeliveryFee(product.vendor, userLat, userLng);

    const distance =
      userLat &&
      userLng &&
      product.vendor.address?.coordinates?.lat &&
      product.vendor.address?.coordinates?.long
        ? parseFloat(
            calculateDistance(
              userLat,
              userLng,
              product.vendor.address.coordinates.lat,
              product.vendor.address.coordinates.long,
            ).toFixed(2),
          )
        : undefined;

    const vendorData = {
      id: product.vendor.id,
      businessName: product.vendor.businessName,
      logoUrl: product.vendor.logoUrl,
      isActive: product.vendor.isActive,
      isVerified: product.vendor.isVerified,
      isOpen,
      deliveryFee,
      deliveryTime,
      distance,
    };

    const { vendor, ...productWithoutVendor } = product;

    return sendSuccess(res, {
      product: {
        ...productWithoutVendor,
        vendor: vendorData,
      },
    });
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

// GET /products/delivery-calculation?vendorId=xxx&lat=xxx&lng=xxx
export const getDeliveryCalculation = async (req: Request, res: Response) => {
  try {
    const { vendorId, lat, lng } = req.query;

    if (
      !vendorId ||
      typeof vendorId !== "string" ||
      !isValidObjectId(vendorId)
    ) {
      throw new AppError(400, "Valid vendorId is required");
    }

    const userLat = lat ? parseFloat(String(lat)) : undefined;
    const userLng = lng ? parseFloat(String(lng)) : undefined;

    if (!userLat || !userLng) {
      throw new AppError(400, "lat and lng are required");
    }

    const vendor = await prisma.vendor.findUnique({
      where: { id: vendorId },
      select: {
        id: true,
        businessName: true,
        address: true,
        avrgPreparationTime: true,
      },
    });

    if (!vendor) {
      throw new AppError(404, "Vendor not found");
    }

    if (
      !vendor.address?.coordinates?.lat ||
      !vendor.address?.coordinates?.long
    ) {
      throw new AppError(400, "Vendor has no location set");
    }

    // Try Geoapify first, fallback to Haversine
    const geoapifyResult = await getGeoapifyRouting(
      userLat,
      userLng,
      vendor.address.coordinates.lat,
      vendor.address.coordinates.long,
    );

    let distance: number;
    let travelTimeMinutes: number;
    let method: string;

    if (geoapifyResult) {
      distance = geoapifyResult.distance;
      travelTimeMinutes = Math.round(geoapifyResult.time / 60);
      method = "geoapify";
    } else {
      distance = parseFloat(
        calculateDistance(
          userLat,
          userLng,
          vendor.address.coordinates.lat,
          vendor.address.coordinates.long,
        ).toFixed(2),
      );
      travelTimeMinutes = Math.round((distance / 2) * 3);
      method = "haversine";
    }

    const hour = new Date().getHours();
    const isPeak = (hour >= 7 && hour < 9) || (hour >= 17 && hour < 20);
    const peakMultiplier = isPeak ? 1.3 : 1.0;

    // Formula: ₦200 base + (₦150/km * peakMultiplier) * distance
    const baseFee = 200;
    const perKmFee = 150 * peakMultiplier;

    const deliveryFee = Math.ceil(baseFee + perKmFee * distance);

    // const deliveryFee = Math.ceil(distance * 2000);

    let prepTime = 25;
    if (vendor.avrgPreparationTime) {
      const match = vendor.avrgPreparationTime.match(/(\d+)-(\d+)/);
      if (match) {
        prepTime = (parseInt(match[1]) + parseInt(match[2])) / 2;
      }
    }

    const totalTime = prepTime + travelTimeMinutes;
    const minTime = Math.floor(totalTime * 0.8);
    const maxTime = Math.ceil(totalTime * 1.2);
    const deliveryTime = `${minTime}-${maxTime} min`;

    return sendSuccess(res, {
      distance: parseFloat(distance.toFixed(2)),
      deliveryTime,
      deliveryFee,
      method,
    });
  } catch (err) {
    return handleError(res, err);
  }
};

import prisma from "@config/db";
import { AppError, handleError, sendSuccess } from "@lib/utils/AppError";
import { Request, Response } from "express";
// import { coerceNumber, isValidObjectId } from "./helpers";
import {
  coerceNumber,
  getVendorIdFromRequest,
  isValidObjectId,
  validateCreateProduct,
  validateUpdateProduct,
} from "./helpers";

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

// POST /api/v1/products
export const createProduct = async (req: Request, res: Response) => {
  try {
    const vendorId = getVendorIdFromRequest(req);
    const data = validateCreateProduct(req.body || {});

    // verify vendor
    const vendor = await prisma.vendor.findUnique({
      where: { id: vendorId },
      select: { id: true, isActive: true, isVerified: true },
    });
    if (!vendor || !vendor.isActive || !vendor.isVerified)
      throw new AppError(403, "Vendor account not active or verified");

    const result = await prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          vendorId,
          name: data.name,
          description: data.description,
          basePrice: data.basePrice,
          sku: data.sku,
          attributes: data.attributes || {},
          isAvailable: data.isAvailable !== false,
        },
      });

      let variants = [] as any[];
      if (data.variants && data.variants.length) {
        const vPromises = data.variants.map((v: any) =>
          tx.productVariant.create({
            data: {
              productId: product.id,
              name: v.name,
              price: v.price,
              // attributes: v.attributes || {},
              stock: v.stock ?? undefined,
              isAvailable: v.isAvailable !== false,
            },
          })
        );
        variants = await Promise.all(vPromises);
      }

      return { product, variants };
    });

    // fetch full product for response
    const complete = await prisma.product.findUnique({
      where: { id: result.product.id },
      include: {
        variants: { orderBy: { createdAt: "asc" } },
        vendor: { select: { id: true, businessName: true } },
      },
    });

    return sendSuccess(
      res,
      { message: "Product created successfully", product: complete },
      201
    );
  } catch (err) {
    return handleError(res, err);
  }
};

// PUT /api/v1/products/:id
export const updateProduct = async (req: Request, res: Response) => {
  try {
    const vendorId = getVendorIdFromRequest(req);
    const { id: productId } = req.params;
    if (!isValidObjectId(productId))
      throw new AppError(400, "Product ID is required");

    const updateData = validateUpdateProduct(req.body || {});

    const existing = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, vendorId: true },
    });
    if (!existing) throw new AppError(404, "Product not found");
    if (existing.vendorId !== vendorId)
      throw new AppError(
        403,
        "Unauthorized: Cannot modify another vendor's product"
      );

    const updated = await prisma.product.update({
      where: { id: productId },
      data: {
        ...updateData,
      },
      include: { variants: { orderBy: { createdAt: "asc" } } },
    });

    return sendSuccess(res, {
      message: "Product updated successfully",
      product: updated,
    });
  } catch (err) {
    return handleError(res, err);
  }
};

// POST /api/v1/products/:id/prepare-delete
export const prepareProductDeletion = async (req: Request, res: Response) => {
  try {
    const vendorId = getVendorIdFromRequest(req);
    const { id: productId } = req.params;
    if (!isValidObjectId(productId))
      throw new AppError(400, "Product ID is required");

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, vendorId: true, isAvailable: true },
    });
    if (!product) throw new AppError(404, "Product not found");
    if (product.vendorId !== vendorId)
      throw new AppError(
        403,
        "Unauthorized: Cannot delete another vendor's product"
      );

    const [updatedProduct] = await prisma.$transaction([
      prisma.product.update({
        where: { id: productId },
        data: { isAvailable: false },
      }),
      prisma.productVariant.updateMany({
        where: { productId },
        data: { isAvailable: false },
      }),
    ]);

    return sendSuccess(res, {
      message: "Product marked as unavailable (prepare-delete)",
      product: updatedProduct,
    });
  } catch (err) {
    return handleError(res, err);
  }
};

// DELETE /api/v1/products/:id
export const deleteProduct = async (req: Request, res: Response) => {
  try {
    const vendorId = getVendorIdFromRequest(req);
    const { id: productId } = req.params;
    if (!isValidObjectId(productId))
      throw new AppError(400, "Product ID is required");

    const product = await prisma.product.findUnique({
      where: { id: productId },
      // select: { id: true, vendorId: true },
      include: { orderItems: { select: { id: true }, take: 1 } },
    });

    if (!product) throw new AppError(404, "Product not found");
    if (product.vendorId !== vendorId)
      throw new AppError(
        403,
        "Unauthorized: Cannot delete another vendor's product"
      );

    // if there are orderItems, refuse permanent deletion
    if (product.orderItems && product.orderItems.length > 0) {
      throw new AppError(
        400,
        "Cannot permanently delete product that has been ordered. Use prepare-delete instead."
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.productVariant.deleteMany({ where: { productId } });
      await tx.product.delete({ where: { id: productId } });
    });

    return sendSuccess(res, { message: "Product permanently deleted" });
  } catch (err) {
    return handleError(res, err);
  }
};

// POST /api/v1/products/:id/variants
export const createProductVariant = async (req: Request, res: Response) => {
  try {
    const vendorId = getVendorIdFromRequest(req);
    const { id: productId } = req.params;

    if (!isValidObjectId(productId))
      throw new AppError(400, "Product ID is required");

    const { name, price, attributes, stock, isAvailable } = req.body || {};

    if (attributes !== undefined && typeof attributes !== "object") {
      throw new AppError(400, "attributes must be a JSON object");
    }

    if (!name || typeof name !== "string" || name.trim().length === 0)
      throw new AppError(400, "Variant name is required");
    const priceNum = coerceNumber(price);
    if (priceNum === null || priceNum <= 0)
      throw new AppError(400, "Valid variant price is required");

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, vendorId: true },
    });
    if (!product) throw new AppError(404, "Product not found");
    if (product.vendorId !== vendorId)
      throw new AppError(
        403,
        "Unauthorized: Cannot modify another vendor's product"
      );

    const variant = await prisma.productVariant.create({
      data: {
        productId,
        name: name.trim(),
        price: priceNum,
        // attributes: attributes ?? {},
        stock: Number.isInteger(stock) ? stock : undefined,
        isAvailable: isAvailable === undefined ? true : Boolean(isAvailable),
      },
    });

    return sendSuccess(
      res,
      { message: "Product variant created successfully", variant },
      201
    );
  } catch (err) {
    return handleError(res, err);
  }
};

// PUT /api/v1/products/:id/variants/:variantId
export const updateProductVariant = async (req: Request, res: Response) => {
  try {
    const vendorId = getVendorIdFromRequest(req);
    const { id: productId, variantId } = req.params;

    if (!isValidObjectId(productId) || !isValidObjectId(variantId))
      throw new AppError(400, "Product ID and Variant ID are required");

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, vendorId: true },
    });
    if (!product) throw new AppError(404, "Product not found");
    if (product.vendorId !== vendorId)
      throw new AppError(
        403,
        "Unauthorized: Cannot modify another vendor's product"
      );

    const existingVariant = await prisma.productVariant.findFirst({
      where: { id: variantId, productId },
    });
    if (!existingVariant) throw new AppError(404, "Product variant not found");

    const { name, price, attributes, stock, isAvailable } = req.body || {};
    const updateData: any = {};

    if (name !== undefined) {
      if (typeof name !== "string" || name.trim().length === 0)
        throw new AppError(400, "Valid variant name is required");
      updateData.name = name.trim();
    }

    if (price !== undefined) {
      const priceNum = coerceNumber(price);
      if (priceNum === null || priceNum <= 0)
        throw new AppError(400, "Valid variant price is required");
      updateData.price = priceNum;
    }

    if (attributes !== undefined) updateData.attributes = attributes;
    if (stock !== undefined) {
      if (!Number.isInteger(stock) || stock < 0)
        throw new AppError(400, "stock must be an integer >= 0");
      updateData.stock = stock;
    }
    if (isAvailable !== undefined)
      updateData.isAvailable = Boolean(isAvailable);

    const updated = await prisma.productVariant.update({
      where: { id: variantId },
      data: updateData,
    });

    return sendSuccess(res, {
      message: "Product variant updated successfully",
      variant: updated,
    });
  } catch (err) {
    return handleError(res, err);
  }
};

// DELETE /api/v1/products/:id/variants/:variantId
export const deleteProductVariant = async (req: Request, res: Response) => {
  try {
    const vendorId = getVendorIdFromRequest(req);
    const { id: productId, variantId } = req.params;

    if (!isValidObjectId(productId) || !isValidObjectId(variantId))
      throw new AppError(400, "Product ID and Variant ID are required");

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, vendorId: true },
    });
    if (!product) throw new AppError(404, "Product not found");
    if (product.vendorId !== vendorId)
      throw new AppError(
        403,
        "Unauthorized: Cannot modify another vendor's product"
      );

    const variant = await prisma.productVariant.findUnique({
      where: { id: variantId },
      include: { orderItems: { select: { id: true }, take: 1 } },
    });
    if (!variant || variant.productId !== productId)
      throw new AppError(404, "Product variant not found");

    if (variant.orderItems && variant.orderItems.length > 0)
      throw new AppError(400, "Cannot delete variant that has been ordered");

    await prisma.productVariant.delete({ where: { id: variantId } });

    return sendSuccess(res, {
      message: "Product variant deleted successfully",
    });
  } catch (err) {
    return handleError(res, err);
  }
};

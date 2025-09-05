import prisma from "@config/db";
import { AppError, handleError, sendSuccess } from "@lib/utils/AppError";
import { Request, Response } from "express";
import {
  coerceNumber,
  getVendorIdFromRequest,
  isValidObjectId,
  validateCreateProduct,
  validateUpdateProduct,
} from "./helpers";

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

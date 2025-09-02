import sendmail from "@config/mail";
import { productDeletionEmailTemplate } from "@lib/emailTemplates";
import { AppError, handleError, sendSuccess } from "@modules/auth/helper";
import { Request, Response } from "express";

// model MenuItem {
//   id          String   @id @default(auto()) @map("_id") @db.ObjectId
//   vendorId    String   @db.ObjectId
//   vendor      Vendor   @relation(fields: [vendorId], references: [id])
//   name        String
//   description String?
//   price       Float
//   imageUrl    String?
//   isAvailable Boolean  @default(true)
//   createdAt   DateTime @default(now())
//   updatedAt   DateTime @updatedAt

//   orderItems OrderItem[]
//   reviews    Review[]
// }

/**
 * GET /api/v1/product
 * Returns first 20 products (include variants)
 */
export const getProducts = async (req: Request, res: Response) => {
  try {
    const products = await prisma?.product.findMany({
      take: 20,
      include: {
        variants: true,
        // include vendor minimal info if you want:
        // vendor: { select: { id: true, businessName: true, logoUrl: true } }
      },
    });

    // findMany returns [] if none — treat as empty list rather than error
    return sendSuccess(res, { products });
  } catch (error: any) {
    handleError(error, res);
  }
};

/**
 * GET /api/v1/product/:id
 */
export const getProductById = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    if (!id) throw new AppError(400, "Product id is required");

    const product = await prisma?.product.findUnique({
      where: { id },
      include: {
        variants: true,
        vendor: { select: { id: true, businessName: true, logoUrl: true } },
      },
    });

    if (!product) throw new AppError(404, "No product found");

    return sendSuccess(res, { product });
  } catch (error: any) {
    handleError(error, res);
  }
};

/**
 * POST /api/v1/product/create
 * body: { name, description?, basePrice, attributes?, isAvailable?, variants?: [{ name, price, stock? }] }
 * Auth: vendor only (req.user.sub expected to be vendor id)
 */
export const createProduct = async (req: Request, res: Response) => {
  const vendorId = req.user?.sub;
  if (!vendorId) return handleError(res, new AppError(401, "Unauthorized"));

  const {
    name,
    description,
    basePrice,
    attributes,
    isAvailable = true,
    variants,
  } = req.body;

  try {
    // Basic validation
    if (typeof name !== "string" || !name.trim() || name.trim().length < 3) {
      throw new AppError(400, "Name must be at least 3 characters");
    }
    const priceNum = parseFloat(String(basePrice));
    if (isNaN(priceNum) || priceNum <= 0) {
      throw new AppError(
        400,
        "basePrice is required and must be a positive number"
      );
    }

    // Make sure vendor exists
    const vendor = await prisma?.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor) throw new AppError(403, "Vendor not found or unauthorized");

    // Optional uniqueness: prevent duplicate product name for same vendor
    const existing = await prisma?.product.findFirst({
      where: {
        name: name.trim(),
        vendorId,
      },
    });
    if (existing)
      throw new AppError(
        400,
        "Product with this name already exists for your account"
      );

    // Prepare nested variant create if any
    let variantCreates = undefined;
    if (Array.isArray(variants) && variants.length > 0) {
      // validate each variant
      const vPayload = variants.map((v: any, idx: number) => {
        if (!v || typeof v.name !== "string" || v.name.trim().length < 1) {
          throw new AppError(400, `Variant at index ${idx} requires a name`);
        }
        const vprice = parseFloat(String(v.price));
        if (isNaN(vprice) || vprice <= 0) {
          throw new AppError(
            400,
            `Variant at index ${idx} requires a positive price`
          );
        }
        const vstock =
          v.stock !== undefined ? parseInt(String(v.stock), 10) : undefined;
        return {
          name: v.name.trim(),
          price: vprice,
          stock: vstock,
        };
      });

      variantCreates = {
        create: vPayload,
      };
    }

    // Create product (with variants nested if provided)
    const newProduct = await prisma?.product.create({
      data: {
        name: name.trim(),
        description: description ?? "",
        basePrice: priceNum,
        attributes: attributes ?? null,
        isAvailable,
        vendor: { connect: { id: vendorId } },
        variants: variantCreates,
      },
      include: {
        variants: true,
      },
    });

    return sendSuccess(res, { product: newProduct });
  } catch (error: any) {
    handleError(error, res);
  }
};

/**
 * PUT /api/v1/product/:id
 * Body may contain: { name?, description?, basePrice?, attributes?, isAvailable? }
 * Vendor-only: must own product
 */
export const updateProduct = async (req: Request, res: Response) => {
  const { id } = req.params;
  const updates = req.body;
  const vendorId = req.user?.sub;

  try {
    if (!id) throw new AppError(400, "Product id is required");
    if (!vendorId) throw new AppError(401, "Unauthorized");
    if (!updates || Object.keys(updates).length === 0)
      throw new AppError(400, "No update fields provided");

    // Ensure product exists
    const product = await prisma?.product.findUnique({ where: { id } });
    if (!product) throw new AppError(404, "Product not found");

    if (product.vendorId !== vendorId)
      throw new AppError(403, "Unauthorized to update this product");

    // Only allow specific fields to be updated
    const allowed: any = {};
    if (typeof updates.name === "string" && updates.name.trim().length >= 3)
      allowed.name = updates.name.trim();
    if (updates.description !== undefined)
      allowed.description = updates.description;
    if (updates.basePrice !== undefined) {
      const priceNum = parseFloat(String(updates.basePrice));
      if (isNaN(priceNum) || priceNum <= 0)
        throw new AppError(400, "basePrice must be a positive number");
      allowed.basePrice = priceNum;
    }
    if (updates.attributes !== undefined)
      allowed.attributes = updates.attributes;
    if (updates.isAvailable !== undefined)
      allowed.isAvailable = !!updates.isAvailable;

    if (Object.keys(allowed).length === 0) {
      throw new AppError(400, "No valid update fields provided");
    }

    const updated = await prisma?.product.update({
      where: { id },
      data: allowed,
      include: { variants: true },
    });

    return sendSuccess(res, {
      message: "Product updated successfully",
      product: updated,
    });
  } catch (error: any) {
    handleError(error, res);
  }
};

/**
 * POST /api/v1/product/prepare-delete
 * Body: { id }
 * Vendor-only: marks product as unavailable and emails vendor
 */
export const prepareProductDeletion = async (req: Request, res: Response) => {
  const { id } = req.body;
  const vendorId = req.user?.sub;

  try {
    if (!id) throw new AppError(400, "Product id is required");
    if (!vendorId) throw new AppError(401, "Unauthorized");

    const product = await prisma?.product.findUnique({ where: { id } });
    if (!product) throw new AppError(404, "Product not found");
    if (product.vendorId !== vendorId) throw new AppError(403, "Unauthorized");

    const updatedProduct = await prisma?.product.update({
      where: { id },
      data: { isAvailable: false },
    });

    const vendor = await prisma?.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor) throw new AppError(404, "Vendor not found");

    // email template & send
    const tpl = productDeletionEmailTemplate(vendor.email, product.name);
    await sendmail(tpl.subject, tpl.html, vendor.email);

    return sendSuccess(res, {
      message: "Product marked as unavailable and vendor notified by email",
      product: updatedProduct,
    });
  } catch (error: any) {
    handleError(error, res);
  }
};

/**
 * DELETE /api/v1/product/:id
 * Permanent delete. Vendor-only (must own).
 */
export const deleteProduct = async (req: Request, res: Response) => {
  const { id } = req.params;
  const vendorId = req.user?.sub;

  try {
    if (!id) throw new AppError(400, "Product id is required");
    if (!vendorId) throw new AppError(401, "Unauthorized");

    const product = await prisma?.product.findUnique({ where: { id } });
    if (!product) throw new AppError(404, "Product not found");
    if (product.vendorId !== vendorId) throw new AppError(403, "Unauthorized");

    const deleted = await prisma?.product.delete({ where: { id } });

    return sendSuccess(res, {
      message: "Product deleted successfully",
      product: deleted,
    });
  } catch (error: any) {
    handleError(error, res);
  }
};

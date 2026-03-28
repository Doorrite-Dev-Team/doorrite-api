import prisma from "@config/db";
// import socketService from "@lib/socketService";
import { AppError, handleError, sendSuccess } from "@lib/utils/AppError";
import { isValidObjectId } from "@modules/product/helpers";
import { Request, Response } from "express";
import {
  coerceNumber,
  createProductSchema,
  updateProductSchema,
} from "./helpers";
import { cacheService } from "@config/cache";

// Get Vendor's Products with Pagination
// GET /api/vendors/:id/products/?page=&limit=
export const getVendorProducts = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor']
   * #swagger.summary = "Get vendor's products with pagination"
   * #swagger.description = 'Fetches a paginated list of products for the currently authenticated vendor.'
   * #swagger.parameters['page'] = { in: 'query', description: 'Page number', type: 'integer' }
   * #swagger.parameters['limit'] = { in: 'query', description: 'Number of items per page', type: 'integer' }
   */
  try {
    console.log("Entered The getVendorProducts successfully", req.params);
    const { id: vendorId } = req.params;

    console.log("Vendor ID:", vendorId);
    if (!vendorId) {
      throw new AppError(404, "Kindly Provide Vendor's ID");
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;

    const totalProducts = await prisma.product.count({
      where: { vendorId },
    });
    const totalPages = Math.ceil(totalProducts / limit);

    const products = await prisma.product.findMany({
      where: { vendorId },
      skip: offset,
      take: limit,
    });
    return sendSuccess(res, {
      products,
      pagination: {
        totalProducts,
        totalPages,
        currentPage: page,
        pageSize: limit,
      },
    });
  } catch (error) {
    handleError(res, error);
  }
};

// POST /api/v1/vendors/products
export const createProduct = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor', 'Vendor Products']
   * #swagger.summary = 'Create a new product'
   * #swagger.description = 'Creates a new product for the authenticated vendor.'
   * #swagger.parameters['body'] = {in: 'body',description: 'Required product data, including name, description, and base price.',required: true,schema: {type: 'object',required: ['name', 'basePrice'],properties: {name: { type: 'string', minLength: 2, description: 'Product name (min 2 characters, required).', example: 'Doorite Food' },description: { type: 'string', description: 'Detailed product description.', example: 'Doorite Food' },basePrice: { type: 'number', minimum: 0.01, description: 'Base price of the product (required, positive number).', example: 5000 },sku: { type: 'string', description: 'Stock keeping unit.', example: '' },attributes: { type: 'object', description: 'A dictionary of custom product attributes.', example: {} },isAvailable: { type: 'boolean', default: true, description: 'Product availability status.', example: false },variants: {type: 'array',description: 'List of product variants.', example: {}}}}}
   */
  try {
    const vendorId = req.user?.sub;
    const { id } = req.params;

    if (!vendorId) throw new AppError(401, "Authentication required");

    // const data = validateCreateProduct(req.body || {});
    const { error, data } = createProductSchema.safeParse(req.body);
    if (error) {
      throw new AppError(400, `Fail to Validate the input ${error.cause}`);
    }

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
          vendorId: vendorId,
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
          }),
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

    // Invalidate vendor and product caches
    await cacheService.invalidatePattern("vendors");
    await cacheService.invalidatePattern("products");

    return sendSuccess(
      res,
      { message: "Product created successfully", product: complete },
      201,
    );
  } catch (err) {
    return handleError(res, err);
  }
};

// PUT /api/v1/vendors/:id/products/:id
export const updateProduct = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor', 'Vendor Products']
   * #swagger.summary = 'Update a product'
   * #swagger.description = 'Updates an existing product for the authenticated vendor.'
   * #swagger.parameters['id'] = { in: 'path', description: 'Product ID', required: true, type: 'string' }
   * #swagger.parameters['body'] = {in: 'body',description: 'Product fields to update. At least one field is required.',required: true,schema: {type: 'object',properties: {name: { type: 'string', minLength: 2, description: 'New product name (min 2 characters).' },description: { type: 'string', description: 'New detailed product description.' },basePrice: { type: 'number', minimum: 0.01, description: 'New base price (positive number).' },sku: { type: 'string', description: 'New stock keeping unit.' },attributes: { type: 'object', description: 'A dictionary of custom product attributes.' },isAvailable: { type: 'boolean', description: 'New product availability status.' }}}}
   */
  try {
    const vendorId = req.user?.sub;
    const { id: productId } = req.params;
    if (!isValidObjectId(productId))
      throw new AppError(400, "Product ID is required");

    const { data: updateData, error } = updateProductSchema.safeParse(
      req.body || {},
    );
    if (error)
      throw new AppError(400, `Error Validating the Inputs: ${error.cause}`);

    const existing = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, vendorId: true },
    });
    if (!existing) throw new AppError(404, "Product not found");
    if (existing.vendorId !== vendorId)
      throw new AppError(
        403,
        "Unauthorized: Cannot modify another vendor's product",
      );

    const updated = await prisma.product.update({
      where: { id: productId },
      data: {
        ...updateData,
      },
      include: { variants: { orderBy: { createdAt: "asc" } } },
    });

    // Invalidate vendor and product caches
    await cacheService.invalidatePattern("vendors");
    await cacheService.invalidatePattern("products");

    return sendSuccess(res, {
      message: "Product updated successfully",
      product: updated,
    });
  } catch (err) {
    return handleError(res, err);
  }
};

// DELETE /api/v1/vendors/:id/products/:id
export const deleteProduct = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor', 'Vendor Products']
   * #swagger.summary = 'Delete a product'
   * #swagger.description = 'Deletes a product for the authenticated vendor. Fails if the product has been ordered.'
   * #swagger.parameters['id'] = { in: 'path', description: 'Product ID', required: true, type: 'string' }
   */
  try {
    const vendorId = req.user?.sub;
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
        "Unauthorized: Cannot delete another vendor's product",
      );

    // if there are orderItems, refuse permanent deletion
    if (product.orderItems && product.orderItems.length > 0) {
      throw new AppError(
        400,
        "Cannot permanently delete product that has been ordered. Use prepare-delete instead.",
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.productVariant.deleteMany({ where: { productId } });
      await tx.product.delete({ where: { id: productId } });
    });

    // Invalidate vendor and product caches
    await cacheService.invalidatePattern("vendors");
    await cacheService.invalidatePattern("products");

    return sendSuccess(res, { message: "Product permanently deleted" });
  } catch (err) {
    return handleError(res, err);
  }
};

// POST /api/v1/vendors/products/:id/variants
export const createProductVariant = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor', 'Vendor Products']
   * #swagger.summary = 'Create a product variant'
   * #swagger.description = 'Creates a new variant for a specific product.'
   * #swagger.parameters['id'] = { in: 'path', description: 'Product ID', required: true, type: 'string' }
   * #swagger.parameters['body'] = { in: 'body', description: 'Product variant data to create', required: true}
   */
  try {
    const vendorId = req.user?.sub;
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
        "Unauthorized: Cannot modify another vendor's product",
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

    // Invalidate vendor and product caches
    await cacheService.invalidatePattern("vendors");
    await cacheService.invalidatePattern("products");

    return sendSuccess(
      res,
      { message: "Product variant created successfully", variant },
      201,
    );
  } catch (err) {
    return handleError(res, err);
  }
};

// PUT /api/v1/vendors/products/:id/variants/:variantId
export const updateProductVariant = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor', 'Vendor Products']
   * #swagger.summary = 'Update a product variant'
   * #swagger.description = 'Updates a specific product variant.'
   * #swagger.parameters['id'] = { in: 'path', description: 'Product ID', required: true, type: 'string' }
   * #swagger.parameters['variantId'] = { in: 'path', description: 'Variant ID', required: true, type: 'string' }
   * #swagger.parameters['body'] = { in: 'body', description: 'Product variant data to update', required: true}
   */
  try {
    const vendorId = req.user?.sub;
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
        "Unauthorized: Cannot modify another vendor's product",
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

    // Invalidate vendor and product caches
    await cacheService.invalidatePattern("vendors");
    await cacheService.invalidatePattern("products");

    return sendSuccess(res, {
      message: "Product variant updated successfully",
      variant: updated,
    });
  } catch (err) {
    return handleError(res, err);
  }
};

// DELETE /api/v1/vendors/products/:id/variants/:variantId
export const deleteProductVariant = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor', 'Vendor Products']
   * #swagger.summary = 'Delete a product variant'
   * #swagger.description = 'Deletes a specific product variant. Fails if the variant has been ordered.'
   * #swagger.parameters['id'] = { in: 'path', description: 'Product ID', required: true, type: 'string' }
   * #swagger.parameters['variantId'] = { in: 'path', description: 'Variant ID', required: true, type: 'string' }
   */
  try {
    const vendorId = req.user?.sub;
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
        "Unauthorized: Cannot modify another vendor's product",
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

    // Invalidate vendor and product caches
    await cacheService.invalidatePattern("vendors");
    await cacheService.invalidatePattern("products");

    return sendSuccess(res, {
      message: "Product variant deleted successfully",
    });
  } catch (err) {
    return handleError(res, err);
  }
};

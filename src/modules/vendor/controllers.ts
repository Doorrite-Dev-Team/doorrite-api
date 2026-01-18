import prisma from "@config/db";
// import socketService from "@lib/socketService";
import { AppError, handleError, sendSuccess } from "@lib/utils/AppError";
import { isValidNigerianPhone } from "@modules/auth/helper";
import { isValidObjectId } from "@modules/product/helpers";
import { Request, Response } from "express";
import {
  coerceNumber,
  createProductSchema,
  updateProductSchema,
} from "./helpers";
import { addressSchema } from "@lib/utils/address";
import { verifyOCCode } from "@config/redis";
import { getActorFromReq } from "@lib/utils/req-res";
import { AppSocketEvent } from "constants/socket";
import { socketService } from "@config/socket";

//Get Vendor Details
//GET /api/vendors/:id
export const getVendorById = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor']
   * #swagger.summary = 'Get vendor details'
   * #swagger.description = 'Fetches a single vendor by their ID.'
   */
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
//GET /api/vendors/me
export const getCurrentVendorProfile = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor']
   * #swagger.summary = "Get current vendor's profile"
   * #swagger.description = 'Fetches the profile of the currently authenticated vendor, including their products and orders.'
   */
  try {
    const vendorId = req.user?.sub; // Assuming vendor ID is available from auth middleware
    if (!vendorId) {
      throw new AppError(401, "Authentication required");
    }

    const vendor = await prisma.vendor.findUnique({
      where: { id: vendorId },
      include: {
        products: true,
        orders: true,
        wallet: true,
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

//Get All Vendors with pagination
//GET /api/vendors
export const getAllVendors = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor']
   * #swagger.summary = 'Get all vendors with pagination'
   * #swagger.description = 'Fetches a paginated list of all vendors.'
   * #swagger.parameters['page'] = { in: 'query', description: 'Page number', type: 'integer' }
   * #swagger.parameters['limit'] = { in: 'query', description: 'Number of items per page', type: 'integer' }
   */
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;
    const totalVendors = await prisma.vendor.count();
    const totalPages = Math.ceil(totalVendors / limit);

    const vendors = await prisma.vendor.findMany({
      skip: offset,
      take: limit,
      include: {
        products: true,
        reviews: true,
      },
    });
    if (!vendors) {
      throw new AppError(404, "Vendors not found");
    }

    return sendSuccess(res, {
      vendors: vendors.map((v) => {
        return { ...v, isOpen: false };
      }),
      pagination: {
        totalVendors,
        totalPages,
        currentPage: page,
        pageSize: limit,
      },
    });
  } catch (error) {
    handleError(res, error);
  }
};

//Update Vendor Profile
// PUT api/v1/vendors/me
export const updateVendorProfile = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor']
   * #swagger.summary = "Update current vendor's profile"
   * #swagger.description = 'Updates the profile of the currently authenticated vendor.'
   * #swagger.parameters['body'] = { in: 'body', description: 'Vendor profile data to update', required: true, schema: { type: 'object', properties: { businessName: { type: 'string' }, phoneNumber: { type: 'string' }, address: { type: 'object' }, logoUrl: { type: 'string' } } } }
   */
  const vendorId = req.user?.sub;
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
    !addressSchema.safeParse(data.address).success &&
    typeof data.address !== "string"
  ) {
    errors.push("Invalid address format");
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

// Get Vendor's Products with Pagination
// GET /api/vendors/products/?page=&limit=
export const getVendorProducts = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor']
   * #swagger.summary = "Get vendor's products with pagination"
   * #swagger.description = 'Fetches a paginated list of products for the currently authenticated vendor.'
   * #swagger.parameters['page'] = { in: 'query', description: 'Page number', type: 'integer' }
   * #swagger.parameters['limit'] = { in: 'query', description: 'Number of items per page', type: 'integer' }
   */
  try {
    const vendorId = req.user?.sub;
    if (!vendorId) {
      throw new AppError(401, "Authentication required");
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

// POST /api/v1/products
export const createProduct = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor', 'Vendor Products']
   * #swagger.summary = 'Create a new product'
   * #swagger.description = 'Creates a new product for the authenticated vendor.'
   * #swagger.parameters['body'] = {in: 'body',description: 'Required product data, including name, description, and base price.',required: true,schema: {type: 'object',required: ['name', 'basePrice'],properties: {name: { type: 'string', minLength: 2, description: 'Product name (min 2 characters, required).', example: 'Doorite Food' },description: { type: 'string', description: 'Detailed product description.', example: 'Doorite Food' },basePrice: { type: 'number', minimum: 0.01, description: 'Base price of the product (required, positive number).', example: 5000 },sku: { type: 'string', description: 'Stock keeping unit.', example: '' },attributes: { type: 'object', description: 'A dictionary of custom product attributes.', example: {} },isAvailable: { type: 'boolean', default: true, description: 'Product availability status.', example: false },variants: {type: 'array',description: 'List of product variants.', example: {}}}}}
   */
  try {
    const vendorId = req.user?.sub;

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

    return sendSuccess(
      res,
      { message: "Product created successfully", product: complete },
      201,
    );
  } catch (err) {
    return handleError(res, err);
  }
};

// PUT /api/v1/vendors/products/:id
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

    return sendSuccess(res, {
      message: "Product updated successfully",
      product: updated,
    });
  } catch (err) {
    return handleError(res, err);
  }
};

// POST /api/v1/vendors/products/:id/prepare-delete
// export const prepareProductDeletion = async (req: Request, res: Response) => {
//   try {
//     const vendorId = req.user?.sub
//     const { id: productId } = req.params;
//     if (!isValidObjectId(productId))
//       throw new AppError(400, "Product ID is required");

//     const product = await prisma.product.findUnique({
//       where: { id: productId },
//       select: { id: true, vendorId: true, isAvailable: true },
//     });
//     if (!product) throw new AppError(404, "Product not found");
//     if (product.vendorId !== vendorId)
//       throw new AppError(
//         403,
//         "Unauthorized: Cannot delete another vendor's product"
//       );

//     const [updatedProduct] = await prisma.$transaction([
//       prisma.product.update({
//         where: { id: productId },
//         data: { isAvailable: false },
//       }),
//       prisma.productVariant.updateMany({
//         where: { productId },
//         data: { isAvailable: false },
//       }),
//     ]);

//     return sendSuccess(res, {
//       message: "Product marked as unavailable (prepare-delete)",
//       product: updatedProduct,
//     });
//   } catch (err) {
//     return handleError(res, err);
//   }
// };

// DELETE /api/v1/vendors/products/:id
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

    return sendSuccess(res, {
      message: "Product variant deleted successfully",
    });
  } catch (err) {
    return handleError(res, err);
  }
};

//GET /vendors/orders/?page=&limit= - List vendor orders
export const getVendorOrders = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor', 'Vendor Orders']
   * #swagger.summary = "Get vendor's orders with pagination"
   * #swagger.description = 'Fetches a paginated list of orders for the currently authenticated vendor.'
   * #swagger.parameters['page'] = { in: 'query', description: 'Page number', type: 'integer' }
   * #swagger.parameters['limit'] = { in: 'query', description: 'Number of items per page', type: 'integer' }
   */
  try {
    const vendorId = req.user?.sub;
    if (!vendorId) {
      throw new AppError(401, "Authentication required");
    }
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;

    const totalOrders = await prisma.order.count({
      where: { vendorId },
    });
    const totalPages = Math.ceil(totalOrders / limit);

    const orders = await prisma.order.findMany({
      where: { vendorId },
      skip: offset,
      take: limit,
      orderBy: { createdAt: "desc" },
    });
    return sendSuccess(res, {
      orders,
      pagination: {
        totalOrders,
        totalPages,
        currentPage: page,
        pageSize: limit,
      },
    });
  } catch (error) {
    handleError(res, error);
  }
};

// GET /vendors/orders/:orderId - Get order details
export const getVendorOrderById = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor', 'Vendor Orders']
   * #swagger.summary = "Get a single order for the vendor"
   * #swagger.description = 'Fetches details of a specific order belonging to the currently authenticated vendor.'
   * #swagger.parameters['orderId'] = { in: 'path', description: 'Order ID', required: true, type: 'string' }
   */
  try {
    const vendorId = req.user?.sub;
    const { orderId } = req.params;
    if (!vendorId) {
      throw new AppError(401, "Authentication required");
    }
    if (!isValidObjectId(orderId)) {
      throw new AppError(400, "Invalid order ID");
    }

    const order = await prisma.order.findFirst({
      where: { id: orderId, vendorId },
      include: {
        items: {
          include: {
            product: {
              include: {
                vendor: { select: { id: true, businessName: true } },
              },
            },
          },
        },
      },
    });
    if (!order) {
      throw new AppError(404, "Order not found");
    }

    return sendSuccess(res, { order });
  } catch (error) {
    handleError(res, error);
  }
};

// PATCH /vendors/orders/:orderId/status
// export const updateOrderStatus = async (req: Request, res: Response) => {
//   /**
//    * #swagger.tags = ['Vendor', 'Vendor Orders']
//    * #swagger.summary = 'Update order status'
//    * #swagger.description = 'Updates the status of an order. Vendors can only set status to ACCEPTED, PREPARING, or CANCELLED.'
//    * #swagger.security = [{ "bearerAuth": [] }]
//    * #swagger.parameters['orderId'] = { in: 'path', description: 'Order ID', required: true, type: 'string' }
//    * #swagger.parameters['body'] = { in: 'body', description: 'Status update data', required: true, schema: { type: 'object', properties: { status: { type: 'string', enum: ['ACCEPTED', 'PREPARING', 'CANCELLED'] }, note: { type: 'string' } } } }
//    */
//   try {
//     const vendorId = req.user?.sub;
//     const { orderId } = req.params;
//     const { status, note } = req.body;

//     if (!vendorId) throw new AppError(401, "Unauthorized");
//     if (!orderId) throw new AppError(400, "Order ID is required");
//     if (!status) throw new AppError(400, "Status is required");

//     // Verify order belongs to vendor
//     const order = await prisma.order.findFirst({
//       where: { id: orderId, vendorId },
//     });

//     if (!order) throw new AppError(404, "Order not found");

//     // Vendor can only set these statuses
//     const allowedStatuses = ["ACCEPTED", "PREPARING", "CANCELLED"];
//     if (!allowedStatuses.includes(status)) {
//       throw new AppError(
//         400,
//         `Vendors can only set status to: ${allowedStatuses.join(", ")}`,
//       );
//     }

//     const result = await prisma.$transaction(async (tx) => {
//       const updated = await tx.order.update({
//         where: { id: orderId },
//         data: { status },
//         include: {
//           items: true,
//           customer: {
//             select: { id: true, fullName: true, email: true },
//           },
//           rider: {
//             select: { id: true, fullName: true },
//           },
//         },
//       });

//       await tx.orderHistory.create({
//         data: {
//           orderId,
//           status,
//           actorId: vendorId,
//           actorType: "VENDOR",
//           note: note ?? `Order status updated to ${status}`,
//         },
//       });

//       return updated;
//     });

//     // Emit order update
//     try {
//       socketService.emitOrderUpdate(result);
//     } catch (e: Error | any) {
//       console.warn("Failed to emit order update:", e?.message || e);
//     }

//     return sendSuccess(res, {
//       message: `Order status updated to ${status}`,
//       order: result,
//     });
//   } catch (error) {
//     handleError(res, error);
//   }
// };
/**
 * PATCH /vendors/orders/:orderId/status
 * Update order status (Vendor Only)
 * Allowed statuses: ACCEPTED, PREPARING, READY_FOR_PICKUP, CANCELLED
 */
export const updateOrderStatus = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor', 'Vendor Orders']
   * #swagger.summary = 'Update order status'
   * #swagger.description = 'Updates the status of an order. Vendors can only set status to ACCEPTED, PREPARING, READY_FOR_PICKUP, or CANCELLED.'
   * #swagger.security = [{ "bearerAuth": [] }]
   * #swagger.parameters['orderId'] = { in: 'path', description: 'Order ID', required: true, type: 'string' }
   * #swagger.parameters['body'] = { in: 'body', description: 'Status update data', required: true, schema: { type: 'object', properties: { status: { type: 'string', enum: ['ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'CANCELLED'] }, note: { type: 'string' } } } }
   */
  try {
    const actor = getActorFromReq(req);
    const { orderId } = req.params;
    const { status, note } = req.body;

    if (!actor) throw new AppError(401, "Unauthorized");
    if (actor.role !== "vendor")
      throw new AppError(403, "Only vendors can update order status");
    if (!orderId) throw new AppError(400, "Order ID is required");
    if (!status) throw new AppError(400, "Status is required");

    // Allowed statuses for vendors
    const allowedStatuses = [
      "ACCEPTED",
      "PREPARING",
      "READY_FOR_PICKUP",
      "CANCELLED",
    ];
    if (!allowedStatuses.includes(status)) {
      throw new AppError(
        400,
        `Vendors can only set status to: ${allowedStatuses.join(", ")}`,
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      // Verify order belongs to vendor
      const order = await tx.order.findFirst({
        where: { id: orderId, vendorId: actor.id },
        include: {
          customer: {
            select: { id: true, fullName: true, email: true },
          },
          vendor: {
            select: { id: true, businessName: true },
          },
          rider: {
            select: { id: true, fullName: true },
          },
        },
      });

      if (!order) throw new AppError(404, "Order not found or access denied");

      // Validate status transitions
      if (status === "ACCEPTED" && order.status !== "PENDING") {
        throw new AppError(400, "Can only accept orders with PENDING status");
      }

      if (status === "PREPARING" && order.status !== "ACCEPTED") {
        throw new AppError(400, "Can only prepare ACCEPTED orders");
      }

      if (status === "READY_FOR_PICKUP" && order.status !== "PREPARING") {
        throw new AppError(400, "Can only mark PREPARING orders as ready");
      }

      if (
        status === "CANCELLED" &&
        !["PENDING", "ACCEPTED"].includes(order.status)
      ) {
        throw new AppError(400, "Can only cancel PENDING or ACCEPTED orders");
      }

      // Update order
      const updated = await tx.order.update({
        where: { id: orderId },
        data: { status },
        include: {
          items: {
            include: {
              product: true,
              variant: true,
            },
          },
          customer: {
            select: { id: true, fullName: true, email: true },
          },
          vendor: {
            select: { id: true, businessName: true },
          },
          rider: {
            select: { id: true, fullName: true },
          },
        },
      });

      // Record history
      await tx.orderHistory.create({
        data: {
          orderId,
          status,
          actorId: actor.id,
          actorType: "VENDOR",
          note:
            note ??
            `Order status updated to ${status} by ${order.vendor.businessName}`,
        },
      });

      return updated;
    });

    // Emit socket notifications
    const notificationRecipients = [
      result.customerId,
      result.vendorId,
      result.riderId,
    ].filter(Boolean) as string[];

    const notificationMap: Record<
      string,
      { title: string; message: string; event: AppSocketEvent }
    > = {
      ACCEPTED: {
        title: `Order Accepted: ${result.id}`,
        message: `${result.vendor.businessName} has accepted your order`,
        event: AppSocketEvent.NOTIFICATION,
      },
      PREPARING: {
        title: `Order Preparing: ${result.id}`,
        message: `${result.vendor.businessName} is preparing your order`,
        event: AppSocketEvent.NOTIFICATION,
      },
      READY_FOR_PICKUP: {
        title: `Order Ready: ${result.id}`,
        message: `Order is ready for pickup from ${result.vendor.businessName}`,
        event: AppSocketEvent.NOTIFICATION,
      },
      CANCELLED: {
        title: `Order Cancelled: ${result.id}`,
        message: `${result.vendor.businessName} cancelled order: ${result.id}`,
        event: AppSocketEvent.NOTIFICATION,
      },
    };

    const notification = notificationMap[status as string];
    if (notification) {
      socketService.notifyTo(notificationRecipients, notification.event, {
        title: notification.title,
        type: status,
        message: notification.message,
        priority: "high",
        metadata: {
          orderId: result.id,
          vendorId: result.vendorId,
          actionUrl: `/orders/${result.id}`,
        },
        timestamp: result.updatedAt.toISOString(),
      });
    }

    return sendSuccess(res, {
      message: notification.message,
      order: result,
    });
  } catch (error) {
    handleError(res, error);
  }
};

// Post /vendors/orders/:orderId/confirm-rider
export const confirmOrderRider = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor', 'Vendor Order']
   * #swagger.summary = 'Confirm if the Rider is Legit'
   * #swagger.description = Confirms the  order rider by verifying code.'
   * #swagger.parameters['id'] = { in: 'path', description: 'Product ID', required: true, type: 'string' }
   * #swagger.parameters['body'] = { in: 'body', description: 'Product variant data to create', required: true}
   */

  try {
    const vendorId = req.user?.sub;
    const { orderId } = req.params;
    const { code } = req.body;

    if (!vendorId) throw new AppError(401, "Unauthorized");
    if (!orderId) throw new AppError(400, "Order ID is required");
    if (!code || code.length !== 6)
      throw new AppError(
        400,
        "6 digit Code is required Kindly Ask the rider for their code",
      );

    // Verify order belongs to vendor
    const order = await prisma.order.findFirst({
      where: { id: orderId, vendorId },
    });

    if (!order) throw new AppError(404, "Order not found");
    if (!order.riderId) throw new AppError(404, "No Assigned Rider Yet");

    const response = await verifyOCCode(
      order.riderId,
      order.vendorId,
      order.id,
      code,
    );
    if (response.ok === (false as const))
      throw new AppError(
        500,
        `Failed to verify the rider's code: ${response.reason}`,
      );

    return sendSuccess(res, { ...response });
  } catch (error) {
    handleError(res, error);
  }
};

// Get Vendor Reviews with Pagination & Aggregation
// GET /api/vendors/:id/reviews
export const getVendorReviews = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor']
   * #swagger.summary = 'Get reviews, average rating, and distribution for a specific vendor'
   * #swagger.description = 'Fetches paginated reviews and aggregate statistics for a vendor.'
   * #swagger.parameters['id'] = { in: 'path', description: 'Vendor ID', required: true, type: 'string' }
   * #swagger.parameters['page'] = { in: 'query', description: 'Page number', type: 'integer' }
   * #swagger.parameters['limit'] = { in: 'query', description: 'Number of items per page', type: 'integer' }
   */
  try {
    const { id: vendorId } = req.params;

    if (!isValidObjectId(vendorId)) {
      throw new AppError(400, "Invalid vendor ID");
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;

    // 1. Check if Vendor exists
    const vendorExists = await prisma.vendor.findUnique({
      where: { id: vendorId },
      select: { id: true },
    });
    if (!vendorExists) {
      throw new AppError(404, "Vendor not found");
    }

    // Use Prisma.$transaction for efficiency
    const [reviews, totalReviews, averageResult, distributionResult] =
      await prisma.$transaction([
        // 2. Paginated Reviews Fetch
        prisma.review.findMany({
          where: { vendorId },
          skip: offset,
          take: limit,
          orderBy: { createdAt: "desc" },
          include: {
            user: {
              select: { fullName: true, profileImageUrl: true, id: true },
            },
          },
        }),

        // 3. Total Count
        prisma.review.count({ where: { vendorId } }),

        // 4. Average Rating Calculation
        prisma.review.aggregate({
          where: { vendorId },
          _avg: { rating: true },
        }),

        // 5. Rating Distribution (Group By)
        prisma.review.groupBy({
          by: ["rating"],
          where: { vendorId },
          _count: { rating: true },
          // REQUIRED FIX: Add orderBy to satisfy TypeScript/Prisma
          orderBy: {
            rating: "desc",
          },
        }),
      ]);

    // --- Data Processing and Transformation ---

    const avgRating = averageResult._avg.rating ?? 0;

    type Count =
      | {
          id?: number | undefined;
          rating?: number | undefined;
          comment?: number | undefined;
          createdAt?: number | undefined;
          updatedAt?: number | undefined;
          userId?: number | undefined;
          productId?: number | undefined;
          vendorId?: number | undefined;
          riderId?: number | undefined;
          _all?: number | undefined;
        }
      | undefined;

    // Map distribution to a usable format
    const ratingDistribution = [5, 4, 3, 2, 1].map((star) => {
      const group = distributionResult.find((r) => r.rating === star);
      const count = (group?._count as Count)?.rating! || 0;
      const percentage = totalReviews > 0 ? (count / totalReviews) * 100 : 0;

      return {
        stars: star,
        count: count,
        percentage: parseFloat(percentage.toFixed(2)),
      };
    });

    // Map fetched reviews to the desired Review interface
    const formattedReviews = reviews.map((review) => ({
      id: review.id,
      userId: review.userId,
      userName: review.user.fullName,
      userAvatar: review.user.profileImageUrl || undefined,
      rating: review.rating,
      comment: review.comment || "",
      createdAt: review.createdAt.toISOString(), // Standard date format
      // NOTE: likes/dislikes require separate models/queries, assuming 0 for now
      likes: 0,
      dislikes: 0,
    }));

    // --- Final Response Structure ---
    const reviewsData = {
      reviews: formattedReviews,
      averageRating: parseFloat(avgRating.toFixed(2)),
      totalReviews: totalReviews,
      ratingDistribution: ratingDistribution,
    };

    return sendSuccess(res, { reviewsData });
  } catch (error) {
    handleError(res, error);
  }
};

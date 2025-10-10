import prisma from "@config/db";
import socketService from "@lib/socketService";
import { AppError, handleError, sendSuccess } from "@lib/utils/AppError";
import { isValidNigerianPhone } from "@modules/auth/helper";
import { isValidObjectId } from "@modules/product/helpers";
import { Request, Response } from "express";
import {
  coerceNumber,
  validateCreateProduct,
  validateUpdateProduct,
} from "./helpers";

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
    const vendorId = req.vendor?.id; // Assuming vendor ID is available from auth middleware
    if (!vendorId) {
      throw new AppError(401, "Authentication required");
    }

    const vendor = await prisma.vendor.findUnique({
      where: { id: vendorId },
      include: {
        products: true,
        orders: true,
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
      vendors,
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
  const vendorId = req.vendor?.id;
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
    (typeof data.address !== "object" ||
      Array.isArray(data.address) ||
      data.address.address.trim() === "")
  ) {
    errors.push("Address must be a valid JSON object");
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
    const vendorId = req.vendor?.id;
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
   * #swagger.parameters['body'] = { in: 'body', description: 'Product data to create', required: true, schema: { $ref: '#/components/schemas/CreateProduct' } }
   */
  try {
    const vendorId = req.user?.sub;
    if (!vendorId) throw new AppError(401, "Authentication required");
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

// PUT /api/v1/vendors/products/:id
export const updateProduct = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor', 'Vendor Products']
   * #swagger.summary = 'Update a product'
   * #swagger.description = 'Updates an existing product for the authenticated vendor.'
   * #swagger.parameters['id'] = { in: 'path', description: 'Product ID', required: true, type: 'string' }
   * #swagger.parameters['body'] = { in: 'body', description: 'Product data to update', required: true, schema: { $ref: '#/components/schemas/UpdateProduct' } }
   */
  try {
    const vendorId = req.user?.sub;
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

// POST /api/v1/vendors/products/:id/variants
export const createProductVariant = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor', 'Vendor Products']
   * #swagger.summary = 'Create a product variant'
   * #swagger.description = 'Creates a new variant for a specific product.'
   * #swagger.parameters['id'] = { in: 'path', description: 'Product ID', required: true, type: 'string' }
   * #swagger.parameters['body'] = { in: 'body', description: 'Product variant data to create', required: true, schema: { $ref: '#/components/schemas/CreateVariant' } }
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

// PUT /api/v1/vendors/products/:id/variants/:variantId
export const updateProductVariant = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor', 'Vendor Products']
   * #swagger.summary = 'Update a product variant'
   * #swagger.description = 'Updates a specific product variant.'
   * #swagger.parameters['id'] = { in: 'path', description: 'Product ID', required: true, type: 'string' }
   * #swagger.parameters['variantId'] = { in: 'path', description: 'Variant ID', required: true, type: 'string' }
   * #swagger.parameters['body'] = { in: 'body', description: 'Product variant data to update', required: true, schema: { $ref: '#/components/schemas/UpdateVariant' } }
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

//GET /vendor/orders/?page=&limit= - List vendor orders
export const getVendorOrders = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor', 'Vendor Orders']
   * #swagger.summary = "Get vendor's orders with pagination"
   * #swagger.description = 'Fetches a paginated list of orders for the currently authenticated vendor.'
   * #swagger.parameters['page'] = { in: 'query', description: 'Page number', type: 'integer' }
   * #swagger.parameters['limit'] = { in: 'query', description: 'Number of items per page', type: 'integer' }
   */
  try {
    const vendorId = req.vendor?.id;
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

// GET /vendor/orders/:orderId - Get order details
export const getVendorOrderById = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor', 'Vendor Orders']
   * #swagger.summary = "Get a single order for the vendor"
   * #swagger.description = 'Fetches details of a specific order belonging to the currently authenticated vendor.'
   * #swagger.parameters['orderId'] = { in: 'path', description: 'Order ID', required: true, type: 'string' }
   */
  try {
    const vendorId = req.vendor?.id;
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

// PATCH /vendor/orders/:orderId/status
export const updateOrderStatus = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Vendor', 'Vendor Orders']
   * #swagger.summary = 'Update order status'
   * #swagger.description = 'Updates the status of an order. Vendors can only set status to ACCEPTED, PREPARING, or CANCELLED.'
   * #swagger.security = [{ "bearerAuth": [] }]
   * #swagger.parameters['orderId'] = { in: 'path', description: 'Order ID', required: true, type: 'string' }
   * #swagger.parameters['body'] = { in: 'body', description: 'Status update data', required: true, schema: { type: 'object', properties: { status: { type: 'string', enum: ['ACCEPTED', 'PREPARING', 'CANCELLED'] }, note: { type: 'string' } } } }
   */
  try {
    const vendorId = req.vendor?.id;
    const { orderId } = req.params;
    const { status, note } = req.body;

    if (!vendorId) throw new AppError(401, "Unauthorized");
    if (!orderId) throw new AppError(400, "Order ID is required");
    if (!status) throw new AppError(400, "Status is required");

    // Verify order belongs to vendor
    const order = await prisma.order.findFirst({
      where: { id: orderId, vendorId },
    });

    if (!order) throw new AppError(404, "Order not found");

    // Vendor can only set these statuses
    const allowedStatuses = ["ACCEPTED", "PREPARING", "CANCELLED"];
    if (!allowedStatuses.includes(status)) {
      throw new AppError(
        400,
        `Vendors can only set status to: ${allowedStatuses.join(", ")}`
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.order.update({
        where: { id: orderId },
        data: { status },
        include: {
          items: true,
          customer: {
            select: { id: true, fullName: true, email: true },
          },
          rider: {
            select: { id: true, fullName: true },
          },
        },
      });

      await tx.orderHistory.create({
        data: {
          orderId,
          status,
          actorId: vendorId,
          actorType: "VENDOR",
          note: note ?? `Order status updated to ${status}`,
        },
      });

      return updated;
    });

    // Emit order update
    try {
      socketService.emitOrderUpdate(result);
    } catch (e: Error | any) {
      console.warn("Failed to emit order update:", e?.message || e);
    }

    return sendSuccess(res, {
      message: `Order status updated to ${status}`,
      order: result,
    });
  } catch (error) {
    handleError(res, error);
  }
};

// POST /vendor/orders/:orderId/assign-rider
// export const assignRiderToOrder = async (req: Request, res: Response) => {
//   try {
//     const vendorId = req.vendor?.id;
//     const { orderId } = req.params;
//     const { riderId } = req.body;

//     if (!vendorId) throw new AppError(401, "Unauthorized");
//     if (!orderId) throw new AppError(400, "Order ID is required");
//     if (!riderId) throw new AppError(400, "Rider ID is required");

//     // Verify order belongs to vendor
//     const order = await prisma.order.findFirst({
//       where: { id: orderId, vendorId },
//     });

//     if (!order) throw new AppError(404, "Order not found");
//     if (order.riderId)
//       throw new AppError(400, "Order already has a rider assigned");

//     // Verify rider exists and is available
//     const rider = await prisma.rider.findUnique({
//       where: { id: riderId },
//       select: { id: true, isActive: true, isAvailable: true },
//     });

//     if (!rider) throw new AppError(404, "Rider not found");
//     if (!rider.isActive) throw new AppError(400, "Rider is not active");
//     if (!rider.isAvailable) throw new AppError(400, "Rider is not available");

//     const result = await prisma.$transaction(async (tx) => {
//       const updated = await tx.order.update({
//         where: { id: orderId },
//         data: {
//           riderId,
//           status: "OUT_FOR_DELIVERY",
//         },
//         include: {
//           items: true,
//           customer: {
//             select: { id: true, fullName: true, email: true },
//           },
//           rider: {
//             select: { id: true, fullName: true, phoneNumber: true },
//           },
//         },
//       });

//       await tx.orderHistory.create({
//         data: {
//           orderId,
//           status: "OUT_FOR_DELIVERY",
//           actorId: vendorId,
//           actorType: "VENDOR",
//           note: `Assigned rider ${riderId} to order`,
//         },
//       });

//       return updated;
//     });

//     return sendSuccess(res, {
//       message: "Rider assigned successfully",
//       order: result,
//     });
//   } catch (error) {
//     return handleError(res, error);
//   }
// };

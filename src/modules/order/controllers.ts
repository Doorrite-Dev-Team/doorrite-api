import { AppError, handleError, sendSuccess } from "@lib/utils/AppError";
import { getActorFromReq } from "@lib/utils/req-res";
import {
  createOrderSchema,
  calculateOrderTotal,
  generateCode,
} from "@modules/order/utils";
import { Request, Response } from "express";
import prisma from "@config/db";
import socketService from "@lib/socketService";
import { ZodError } from "zod/v3";

// GET api/v1/orders?status=&vendorId=&customerId=&page=&limit=&from=&to=
export const getOrders = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Order']
   * #swagger.summary = 'Get orders'
   * #swagger.description = 'Get all orders'
   */
  try {
    const actor = getActorFromReq(req);
    if (!actor?.id) throw new AppError(401, "Unauthorized");

    // Query params
    const {
      page = "1",
      limit = "20",
      status,
      vendorId,
      customerId,
      from,
      to,
    } = req.query as Record<string, string>;

    const pageNum = Math.max(1, parseInt(page || "1", 10));
    const lim = Math.min(100, Math.max(1, parseInt(limit || "20", 10)));
    const skip = (pageNum - 1) * lim;

    // Build base where clause depending on role
    const where: any = {};

    switch (actor.role) {
      case "CUSTOMER":
        where.customerId = actor.id;
        break;
      case "VENDOR":
        where.vendorId = actor.id;
        if (customerId) where.customerId = customerId;
        break;
      case "ADMIN":
        if (vendorId) where.vendorId = vendorId;
        if (customerId) where.customerId = customerId;
        break;
      default:
        throw new AppError(403, "Invalid role");
    }

    // Global filters
    if (status) where.status = status;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    // Count + fetch
    const total = await prisma.order.count({ where });

    const orders = await prisma.order.findMany({
      where,
      take: lim,
      skip,
      orderBy: { createdAt: "desc" },
      include: {
        items: { include: { product: true, variant: true } },
        customer: { select: { id: true, fullName: true, email: true } },
        vendor: { select: { id: true, businessName: true } },
        payment: true,
        delivery: true,
        history: { orderBy: { createdAt: "desc" } },
      },
    });

    return sendSuccess(res, {
      orders,
      total,
      page: pageNum,
      limit: lim,
    });
  } catch (err: any) {
    return handleError(res, err);
  }
};

// GET /api/v1/orders/:id
export const getOrderById = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Order']
   * #swagger.summary = 'Get order by ID'
   * #swagger.description = 'Get a single order by its ID'
   */
  const { id } = req.params;

  try {
    if (!id) throw new AppError(400, "Order id is required");

    const actor = getActorFromReq(req);
    if (!actor?.id) throw new AppError(401, "Unauthorized");

    // Build role-aware WHERE
    const where: any = { id };
    switch (actor.role) {
      case "CUSTOMER":
        where.customerId = actor.id;
        break;
      case "VENDOR":
        where.vendorId = actor.id;
        break;
      case "ADMIN":
        // Admin sees everything — no extra filter
        break;
      default:
        throw new AppError(403, "Invalid role");
    }

    const order = await prisma.order.findFirst({
      where,
      include: {
        items: { include: { product: true, variant: true } },
        customer: {
          select: { id: true, fullName: true, email: true, phoneNumber: true },
        },
        vendor: { select: { id: true, businessName: true, logoUrl: true } },
        payment: true,
        delivery: true,
        history: { orderBy: { createdAt: "desc" } },
      },
    });

    if (!order) throw new AppError(404, "Order not found or access denied");

    // Redact sensitive payment fields for non-admins
    if (actor.role !== "ADMIN" && order.payment) {
      delete (order.payment as any).transactionId;
    }

    return sendSuccess(res, { order });
  } catch (error: any) {
    return handleError(res, error);
  }
};

// POST /api/v1/orders
export const createOrder = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Order']
   * #swagger.summary = 'Create order'
   * #swagger.description = 'Create a new order'
   */
  try {
    // ✅ Validate request body using Zod (throws if invalid)
    const parsed = createOrderSchema.parse(req.body || {});
    const { vendorId, items, deliveryAddress, paymentMethod } = parsed;

    // ✅ Get authenticated user
    const { id: customerId } = getActorFromReq(req);
    if (!customerId) throw new AppError(401, "Unauthorized");

    // ✅ Run transactional logic
    const result = await prisma.$transaction(async (tx) => {
      // 1. Verify vendor exists
      const vendor = await tx.vendor.findUnique({ where: { id: vendorId } });
      if (!vendor) throw new AppError(404, "Vendor not found");

      // 2. Verify customer exists
      const customer = await tx.user.findUnique({ where: { id: customerId } });
      if (!customer) throw new AppError(404, "Customer not found");

      // 3. Calculate total amount
      const totalAmount = await calculateOrderTotal(items);

      // 5. Create order
      const order = await tx.order.create({
        data: {
          customerId,
          vendorId,
          deliveryAddress,
          totalAmount,
          status: "PENDING",
          paymentStatus: "PENDING",
          items: {
            create: await Promise.all(
              items.map(async (item) => {
                const product = await tx.product.findUnique({
                  where: { id: item.productId },
                  include: { variants: true },
                });

                if (!product)
                  throw new AppError(
                    404,
                    `Product ${item.productId} not found`
                  );

                // Handle variant price
                let price = product.basePrice;
                if (item.variantId) {
                  const variant = product.variants.find(
                    (v) => v.id === item.variantId
                  );
                  if (!variant)
                    throw new AppError(
                      404,
                      `Variant ${item.variantId} not found for product ${item.productId}`
                    );
                  price = variant.price;
                }

                return {
                  productId: item.productId,
                  variantId: item.variantId,
                  quantity: item.quantity,
                  price,
                  unitPrice: price,
                  subtotal: price * item.quantity,
                };
              })
            ),
          },
        },
        include: {
          items: { include: { product: true, variant: true } },
          customer: { select: { id: true, fullName: true, email: true } },
          vendor: { select: { id: true, businessName: true } },
        },
      });

      // 6. Create payment if Paystack
      let payment = null;
      if (paymentMethod === "PAYSTACK") {
        payment = await tx.payment.create({
          data: {
            orderId: order.id,
            userId: customerId,
            amount: totalAmount,
            status: "PENDING",
            method: "PAYSTACK",
          },
        });
      }

      // 7. Record history
      await tx.orderHistory.create({
        data: {
          orderId: order.id,
          status: "PENDING",
          actorId: customerId,
          actorType: "SYSTEM",
          note: "Order created and placed",
        },
      });

      socketService.emitOrderUpdate(order);
      return { order, payment };
    });

    // ✅ Send response
    return sendSuccess(
      res,
      {
        order: result.order,
        payment: result.payment,
        nextAction: result.payment
          ? "INITIALIZE_PAYSTACK_PAYMENT"
          : "ORDER_PLACED_COD",
      },
      201
    );
  } catch (error: any) {
    // ✅ Graceful Zod validation error handling
    if (error instanceof ZodError) {
      const formatted = error.errors.map((e) => ({
        path: e.path.join("."),
        message: e.message,
      }));
      return res.status(400).json({
        ok: false,
        message: "Invalid request body",
        errors: formatted,
      });
    }

    console.error("Error creating order:", error);
    handleError(res, error);
  }
};

// PATCH /orders/:orderId/cancel - Cancel order
export const cancelOrder = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Order']
   * #swagger.summary = 'Cancel order'
   * #swagger.description = 'Cancel an order'
   */
  const { id } = req.params;
  const { reason } = req.body;
  const actor = getActorFromReq(req);
  const { id: customerId } = getActorFromReq(req);
  if (!customerId) throw new AppError(401, "Unauthorized");
  try {
    if (!id) throw new AppError(400, "Order id is required");
    if (!reason) throw new AppError(400, "Cancellation reason is required");
    if (!actor?.id) throw new AppError(401, "Unauthorized");
    if (actor.role !== "CUSTOMER")
      throw new AppError(403, "Only customers can cancel orders");
    const result = await prisma.$transaction(async (tx) => {
      // Fetch order
      const order = await tx.order.findUnique({
        where: { id },
        include: { items: true, customer: true, vendor: true, rider: true },
      });
      if (!order) throw new AppError(404, "Order not found");
      if (order.customerId !== customerId) {
        throw new AppError(403, "You can only cancel your own orders");
      }
      if (order.status !== "PENDING") {
        throw new AppError(
          400,
          "You can only cancel orders in the PENDING status"
        );
      }
      //
      const updatedOrder = await tx.order.update({
        where: { id },
        data: {
          status: "CANCELLED",
        },
        include: {
          items: {
            include: {
              product: true,
              variant: true,
            },
          },
          customer: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },

          vendor: {
            select: {
              id: true,
              businessName: true,
            },
          },
          rider: {
            select: {
              id: true,
              fullName: true,
              email: true,
              phoneNumber: true,
            },
          },
        },
      });
      //
      await tx.orderHistory.create({
        data: {
          orderId: updatedOrder.id,

          status: "CANCELLED",

          actorId: actor.id,
          actorType: "CUSTOMER",
          note: `Order cancelled by customer. Reason: ${reason}`,
        },
      });
      return updatedOrder;
    });
    // Emit order update to clients
    socketService.emitOrderUpdate(result);

    return sendSuccess(res, {
      order: result,
      nextAction: "ORDER_CANCELLED",
    });
  } catch (error: any) {
    console.error("Error canceling order:", error);

    handleError(res, error);
  }
};

/**
 * @desc    Get 6 digit delivery verification code (for customer)
 * @route   GET /api/v1/users/orders/:orderId/verification
 * @access  Private - User (Customer) only
 */
export const getCustomerVerificationCode = async (
  req: Request,
  res: Response
) => {
  /**
   * #swagger.tags = ['User Orders']
   * #swagger.summary = 'Get 6 digit delivery verification code'
   * #swagger.description = 'Used by the customer to get the code to show the rider.'
   * #swagger.security = [{ "bearerAuth": [] }]
   * #swagger.parameters['orderId'] = { in: 'path', description: 'Order ID', required: true, type: 'string' }
   */

  try {
    const { orderId } = req.params;
    const actor = getActorFromReq(req);

    if (!orderId) throw new AppError(400, "Order ID is required");
    if (!actor?.id) throw new AppError(401, "Unauthorized");
    if (actor.role !== "USER")
      throw new AppError(403, "Only customers can access this");

    const order = await prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) throw new AppError(404, "Order not found");
    if (order.customerId !== actor.id)
      throw new AppError(403, "You are not authorized to view this order");

    // Only allow code generation/retrieval when it's out for delivery
    if (order.status !== "OUT_FOR_DELIVERY") {
      throw new AppError(
        400,
        "Verification code is only available when order is out for delivery"
      );
    }

    let code = order.deliveryVerificationCode;

    // If code doesn't exist, generate and save it
    if (!code) {
      code = generateCode();
      await prisma.order.update({
        where: { id: orderId },
        data: { deliveryVerificationCode: code },
      });
    }

    return sendSuccess(res, { verificationCode: code });
  } catch (error) {
    handleError(res, error);
  }
};

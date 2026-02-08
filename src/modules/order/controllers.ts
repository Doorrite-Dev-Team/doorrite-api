import { AppError, handleError, sendSuccess } from "@lib/utils/AppError";
import { getActorFromReq } from "@lib/utils/req-res";
import {
  createOrderSchema,
  calculateOrderTotal,
  generateCode,
} from "@modules/order/utils";
import { Request, Response } from "express";
import prisma from "@config/db";
import { socketService } from "@config/socket";
import { ZodError } from "zod/v3";
import { AppSocketEvent } from "constants/socket";
import { CacheMemory, cacheService } from "@config/cache";
import { Pagination } from "types/types";
import { Order } from "generated/prisma";

// GET api/v1/orders?status=&vendorId=&customerId=&page=&limit=&from=&to=
export const getOrders = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Order']
   * #swagger.summary = 'Get orders'
   * #swagger.description = 'Get all orders'
   */
  try {
    const actor = getActorFromReq(req);
    if (!actor) throw new AppError(401, "Unauthorized");

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

    const key = cacheService.generateKey("orders", `${pageNum}_${lim}_${skip}`);
    const cacheHit =
      await cacheService.get<Pagination<{ orders: Order[] }>>(key);

    if (cacheHit) {
      console.debug(
        "--------------------------------Cache----------------------------",
      );

      return sendSuccess(res, cacheHit);
    }

    console.debug(
      "--------------------------------Missed----------------------------",
    );

    // Build base where clause depending on role
    const where: any = {};

    switch (actor.role) {
      case "user":
        where.customerId = actor.id;
        break;
      case "vendor":
        where.vendorId = actor.id;
        if (customerId) where.customerId = customerId;
        break;
      case "admin":
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

    const data = {
      orders,
      total,
      page: pageNum,
      limit: lim,
    };

    console.debug(
      "--------------------------------Adding to Cache----------------------------",
    );
    await cacheService.set(key, data);

    return sendSuccess(res, data);
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
    if (!actor) throw new AppError(401, "Unauthorized");

    const key = cacheService.generateKey("orders", id);
    const cacheHit = await cacheService.get<{ order: Order }>(key);

    if (cacheHit) {
      console.debug("--------------------------------Cache----------------------------");
      return sendSuccess(res, cacheHit);
    }

    console.debug("--------------------------------Missed----------------------------");

    // Build role-aware WHERE
    const where: any = { id };
    switch (actor.role) {
      case "vendor":
        where.vendorId = actor.id;
        break;
      case "admin":
        // Admin sees everything — no extra filter
        break;
      default:
        where.customerId = actor.id;
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
    if (actor.role !== "admin" && order.payment) {
      delete (order.payment as any).transactionId;
    }

    const data = { order };
    console.debug("--------------------------------Adding to Cache----------------------------");
    await cacheService.set(key, data);

    return sendSuccess(res, data);
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
    console.log("CREATE ORDER:", req.body);
    console.log("Failed: ", createOrderSchema.parse(req.body));
    const parsed = createOrderSchema.parse(req.body || {});
    const { vendorId, items, contactInfo, deliveryAddress, paymentMethod } =
      parsed;

    const actor = getActorFromReq(req);
    if (!actor || !actor.id) throw new AppError(401, "Unauthorized");
    const customerId = actor.id;

    const result = await prisma.$transaction(async (tx) => {
      // Verify vendor and customer
      const vendor = await tx.vendor.findUnique({ where: { id: vendorId } });
      if (!vendor) throw new AppError(404, "Vendor not found");

      const customer = await tx.user.findUnique({ where: { id: customerId } });
      if (!customer) throw new AppError(404, "Customer not found");

      // Calculate total
      const calcAmount = await calculateOrderTotal(items);
      const totalKobo = Math.round(calcAmount * 100 * 1.1);
      const totalAmount = Math.round((totalKobo / 100) * 100) / 100;

      // Determine initial status based on payment method
      const initialStatus =
        paymentMethod === "PAYSTACK" ? "PENDING_PAYMENT" : "PENDING";
      // const paymentStatus = paymentMethod === "PAYSTACK" ? "PENDING" : "";

      // Create order
      const order = await tx.order.create({
        data: {
          customerId,
          vendorId,
          deliveryAddress,
          contactInfo,
          totalAmount,
          status: initialStatus,
          paymentStatus: "PENDING",
          items: {
            create: await Promise.all(
              items.map(async (item) => {
                const { productId, variantId, quantity = 1 } = item as any;

                const product = await tx.product.findUnique({
                  where: { id: productId },
                  select: {
                    id: true,
                    vendorId: true,
                    isAvailable: true,
                    basePrice: true,
                  },
                });

                if (!product)
                  throw new AppError(404, `Product ${productId} not found`);
                if (product.vendorId !== vendorId)
                  throw new AppError(
                    400,
                    `Product ${productId} does not belong to vendor`,
                  );
                if (!product.isAvailable)
                  throw new AppError(
                    400,
                    `Product ${productId} is not available`,
                  );

                let variant: any = null;
                if (variantId) {
                  variant = await tx.productVariant.findUnique({
                    where: { id: variantId },
                  });
                  if (!variant || variant.productId !== productId)
                    throw new AppError(404, `Variant ${variantId} not found`);
                  if (!variant.isAvailable)
                    throw new AppError(
                      400,
                      `Variant ${variantId} is not available`,
                    );

                  if (typeof variant.stock === "number") {
                    if (variant.stock < quantity)
                      throw new AppError(
                        400,
                        `Insufficient stock for variant ${variantId}`,
                      );
                    await tx.productVariant.update({
                      where: { id: variantId },
                      data: { stock: variant.stock - quantity },
                    });
                  }
                }

                const price = variant
                  ? variant.price
                  : (product.basePrice ?? 0);

                return {
                  productId,
                  variantId: variantId || undefined,
                  quantity,
                  price,
                  // unitPrice: price,
                  // subtotal: price * quantity,
                };
              }),
            ),
          },
        },
        include: {
          items: { include: { product: true, variant: true } },
          customer: { select: { id: true, fullName: true, email: true } },
          vendor: { select: { id: true, businessName: true } },
        },
      });

      // Create payment record for Paystack
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

      // Record history
      await tx.orderHistory.create({
        data: {
          orderId: order.id,
          status: initialStatus,
          actorId: customerId,
          actorType: "USER",
          note: `Order created by ${customer.fullName}`,
        },
      });

      // Only notify vendor if payment is COD (order is ready to process)
      if (paymentMethod !== "PAYSTACK") {
        socketService.notify(vendorId, AppSocketEvent.NEW_ORDER, {
          title: `New Order From: ${customer.fullName}`,
          type: "ORDER_PLACED",
          message: `Kindly Accept or Reject Order: ${order.id}`,
          priority: "high",
          metadata: {
            orderId: order.id,
            vendorId: vendorId,
            amount: order.totalAmount,
            actionUrl: `/orders/${order.id}`,
          },
          timestamp: order.createdAt.toISOString(),
        });
      }

      return { order, payment };
    });

    // Invalidate relevant caches
    await cacheService.invalidatePattern("orders");
    await cacheService.invalidatePattern("userOrders");
    await cacheService.invalidatePattern("vendors");

    return sendSuccess(
      res,
      {
        order: result.order,
        payment: result.payment,
        nextAction: result.payment
          ? "INITIALIZE_PAYSTACK_PAYMENT"
          : "ORDER_PLACED_COD",
      },
      201,
    );
  } catch (error: any) {
    if (error instanceof ZodError) {
      console.log("ZOD ERROR DETAILS:", error.format());
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

// PATCH /orders/:id/cancel - Cancel order (User/Admin only)
export const cancelOrder = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Order']
   * #swagger.summary = 'Cancel order'
   * #swagger.description = 'Cancel an order (User/Admin only)'
   */
  const { id } = req.params;
  const { reason } = req.body;
  const actor = getActorFromReq(req);

  try {
    if (!id) throw new AppError(400, "Order id is required");
    if (!reason) throw new AppError(400, "Cancellation reason is required");
    if (!actor) throw new AppError(401, "Unauthorized");
    if (actor.role !== "user" && actor.role !== "admin") {
      throw new AppError(403, "Only customers and admins can cancel orders");
    }

    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id },
        include: { items: true, customer: true, vendor: true, rider: true },
      });

      if (!order) throw new AppError(404, "Order not found");

      if (actor.role === "user" && order.customerId !== actor.id) {
        throw new AppError(403, "You can only cancel your own orders");
      }

      if (!["PENDING", "PENDING_PAYMENT", "ACCEPTED"].includes(order.status)) {
        throw new AppError(400, "Cannot cancel order at this stage");
      }

      const updatedOrder = await tx.order.update({
        where: { id },
        data: { status: "CANCELLED" },
        include: {
          items: { include: { product: true, variant: true } },
          customer: { select: { id: true, fullName: true, email: true } },
          vendor: { select: { id: true, businessName: true } },
          rider: { select: { id: true, fullName: true } },
        },
      });

      await tx.orderHistory.create({
        data: {
          orderId: updatedOrder.id,
          status: "CANCELLED",
          actorId: actor.id,
          actorType: actor.role === "admin" ? "ADMIN" : "USER",
          note: `Order cancelled by ${actor.role === "admin" ? "Admin" : order.customer.fullName}. Reason: ${reason}`,
        },
      });

      return updatedOrder;
    });

    // Emit notifications
    const notificationRecipients = [
      result.vendorId,
      result.customerId,
      result.riderId,
    ].filter(Boolean) as string[];

    const cancellerName =
      actor.role === "admin" ? "Admin" : result.customer.fullName;

    socketService.notifyTo(
      notificationRecipients,
      AppSocketEvent.NOTIFICATION,
      {
        title: `Order Cancelled: ${result.id}`,
        type: "ORDER_CANCELLED",
        message: `${cancellerName} cancelled order: ${result.id}`,
        priority: "high",
        metadata: {
          orderId: result.id,
          vendorId: result.vendorId,
          actionUrl: `/orders/${result.id}`,
          cancelledBy: actor.role,
        },
        timestamp: result.updatedAt.toISOString(),
      },
    );

    // Invalidate relevant caches
    await cacheService.invalidatePattern("orders");
    await cacheService.invalidatePattern("userOrders");
    await cacheService.invalidatePattern("vendors");

    return sendSuccess(res, {
      order: result,
      message: "Order cancelled successfully",
    });
  } catch (error: any) {
    console.error("Error canceling order:", error);
    handleError(res, error);
  }
};

// GET /orders/:id/payments/status
export const checkPaymentStatus = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Payment']
   * #swagger.summary = 'Check payment status'
   * #swagger.description = 'Checks the payment status for an order.'
   * #swagger.security = [{ "bearerAuth": [] }]
   * #swagger.parameters['id'] = { in: 'path', description: 'Order ID', required: true, type: 'string' }
   */
  try {
    const { id: orderId } = req.params;
    const actor = getActorFromReq(req);

    if (!actor) throw new AppError(401, "Unauthorized");

    // Build role-aware query
    const where: any = { orderId };
    const role = String(actor.role || "").toLowerCase();
    if (role === "user" || role === "customer") {
      where.userId = actor.id;
    } else if (role === "vendor") {
      where.order = { vendorId: actor.id };
    }

    const payment = await prisma.payment.findFirst({
      where,
      include: {
        order: {
          select: {
            id: true,
            status: true,
            paymentStatus: true,
            totalAmount: true,
          },
        },
      },
    });

    if (!payment) {
      throw new AppError(404, "Payment not found");
    }

    return sendSuccess(res, { payment });
  } catch (error: any) {
    console.error("Payment status check error:", error);
    return handleError(res, error);
  }
};

/**
 * @desc    Get 6 digit delivery verification code (for customer)
 * @route   GET /api/v1/users/orders/:orderId/verification
 * @access  Private - User (Customer) only
 */
export const getCustomerVerificationCode = async (
  req: Request,
  res: Response,
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
    if (!actor) throw new AppError(401, "Unauthorized");
    const role = String(actor.role || "").toLowerCase();
    if (role !== "user")
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
        "Verification code is only available when order is out for delivery",
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

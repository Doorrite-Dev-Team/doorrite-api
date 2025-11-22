import { AppError, handleError, sendSuccess } from "@lib/utils/AppError";
import { getActorFromReq } from "@lib/utils/req-res";
import {
  createOrderSchema,
  calculateOrderTotal,
  generateCode,
} from "@modules/order/utils";
import { Request, Response } from "express";
import prisma from "@config/db";
import { Prisma } from "../../generated/prisma";
import socketService from "@lib/socketService";
import { ZodError } from "zod/v3";
import paystack from "@config/payments/paystack";
// import { handleSuccessfulCharge } from "../_payment/helper";
import { redis } from "@config/redis";

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
    if (!actor) throw new AppError(401, "Unauthorized");

    // Build role-aware WHERE
    const where: any = { id };
    switch (actor.role) {
      case "user":
        where.customerId = actor.id;
        break;
      case "vendor":
        where.vendorId = actor.id;
        break;
      case "admin":
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
    if (actor.role !== "admin" && order.payment) {
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

    // ✅ Get authenticated user (avoid destructuring undefined)
    const actor = getActorFromReq(req);
    // const role = String(actor?.role || "").toLowerCase();
    if (!actor || !actor.id) throw new AppError(401, "Unauthorized");
    const customerId = actor.id;

    // ✅ Run transactional logic
    const result = await prisma.$transaction(async (tx) => {
      // 1. Verify vendor exists
      const vendor = await tx.vendor.findUnique({ where: { id: vendorId } });
      if (!vendor) throw new AppError(404, "Vendor not found");

      // 2. Verify customer exists
      const customer = await tx.user.findUnique({ where: { id: customerId } });
      if (!customer) throw new AppError(404, "Customer not found");

      // 3. Calculate total amount
      const calcAmount = await calculateOrderTotal(items);
      // Work in minor units (kobo) to avoid floating errors. If calculateOrderTotal returns Naira,
      // convert to kobo, add 10% fee, round, then store back as Naira with 2 decimals.
      const totalKobo = Math.round(calcAmount * 100 * 1.1);
      const totalAmount = Math.round((totalKobo / 100) * 100) / 100;

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
                const { productId, variantId, quantity = 1 } = item as any;

                // Fetch product & basic fields
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
                    `Product ${productId} does not belong to vendor ${vendorId}`,
                  );
                if (product.isAvailable === false)
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
                    throw new AppError(
                      404,
                      `Variant ${variantId} not found for product ${productId}`,
                    );
                  if (variant.isAvailable === false)
                    throw new AppError(
                      400,
                      `Variant ${variantId} is not available`,
                    );

                  // If variant has stock tracked (number), ensure sufficient quantity and decrement
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
                  unitPrice: price,
                  subtotal: price * quantity,
                } as any;
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

      // 6. Create payment if Paystack
      let payment: Prisma.PaymentCreateArgs["data"] | null = null;
      if (paymentMethod === "PAYSTACK") {
        // prevent duplicate pending payment records
        const existing = await tx.payment.findFirst({
          where: { orderId: order.id, status: "PENDING" },
        });
        if (existing) {
          payment = existing;
        } else {
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
      201,
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
  // const { id: customerId } = getActorFromReq(req);

  try {
    if (!id) throw new AppError(400, "Order id is required");
    if (!reason) throw new AppError(400, "Cancellation reason is required");
    if (!actor) throw new AppError(401, "Unauthorized");
    if (
      actor.role !== "user" &&
      actor.role !== "admin" &&
      actor.role !== "vendor"
    )
      throw new AppError(
        403,
        "Only customers, admins and vendors can cancel orders",
      );
    const result = await prisma.$transaction(async (tx) => {
      // Fetch order
      const order = await tx.order.findUnique({
        where: { id },
        include: { items: true, customer: true, vendor: true, rider: true },
      });
      if (!order) throw new AppError(404, "Order not found");
      if (actor.role === "user" && order.customerId !== actor.id) {
        throw new AppError(403, "You can only cancel your own orders");
      }
      if (order.status !== "PENDING") {
        throw new AppError(
          400,
          "You can only cancel orders in the PENDING status",
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
          actorType: "user",
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

// -----------------------
// Payment endpoints (moved from modules/payment/controllers.ts)
// -----------------------

// POST /orders/:id/payments/create-intent
export const createPaymentIntent = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Payment']
   * #swagger.summary = 'Create a payment intent'
   * #swagger.description = 'Creates a payment intent for an order.'
   * #swagger.security = [{ "bearerAuth": [] }]
   * #swagger.parameters['body'] = { in: 'body', description: 'Order ID', required: true, schema: { type: 'object', properties: { id: { type: 'string' } } } }
   */
  try {
    const { id: orderId } = req.params;
    const actor = getActorFromReq(req);

    const role = String(actor?.role || "").toLowerCase();

    if (!actor || (role !== "user" && role !== "customer"))
      throw new AppError(401, "Unauthorized");
    if (!orderId) throw new AppError(400, "Order ID is required");

    const result = await prisma.$transaction(async (tx) => {
      // 1. Fetch order and verify ownership
      const order = await tx.order.findFirst({
        where: {
          id: orderId,
          customerId: actor.id,
          status: "PENDING",
          paymentStatus: "PENDING",
        },
        include: {
          customer: {
            select: {
              email: true,
              fullName: true,
              phoneNumber: true,
            },
          },
        },
      });

      if (!order) {
        throw new AppError(404, "Order not found or payment already initiated");
      }

      // 2. Prevent duplicate initializations: check existing pending payment
      const existingPayment = await tx.payment.findFirst({
        where: { orderId: order.id, status: "PENDING" },
      });
      const cacheKey = `payment:init:${order.id}`;
      const lockKey = `payment:init:lock:${order.id}`;

      // If there is an existing pending payment with a cached init, reuse it
      const cached = await redis.get(cacheKey);
      if (existingPayment && cached) {
        try {
          const parsed =
            typeof cached === "string" ? JSON.parse(cached) : cached;
          return {
            paymentId: existingPayment.id,
            authorization_url: parsed.authorization_url,
          };
        } catch (e) {
          // ignore parse issues and proceed to re-init below
        }
      }

      // Acquire short Redis lock to avoid parallel inits
      const lock = await redis.set(lockKey, "1", { nx: true, ex: 30 });
      if (!lock) {
        // Another process is initializing - wait briefly for cache to populate
        const waited = await redis.get(cacheKey);
        if (waited) {
          const parsed =
            typeof waited === "string" ? JSON.parse(waited) : waited;
          // If we have an existing payment record, return its id
          if (existingPayment)
            return {
              paymentId: existingPayment.id,
              authorization_url: parsed.authorization_url,
            };
          // Otherwise, allow caller to retry
          throw new AppError(
            409,
            "Payment initialization in progress. Please retry shortly.",
          );
        }
        throw new AppError(
          409,
          "Payment initialization in progress. Please retry shortly.",
        );
      }

      try {
        // 3. Initialize Paystack transaction using helper (send minor units)
        const init = await paystack.initializeTransaction({
          email: order.customer.email,
          amount: Math.round(order.totalAmount * 100), // send kobo
          reference: `ORDER_${order.id}_${Date.now()}`,
          callback_url: `${
            process.env.FRONTEND_URL ?? "https://doorrite-user-ui.netlify.app"
          }/payment/verify`,
          metadata: {
            order_id: order.id,
            custom_fields: [
              {
                display_name: "Order ID",
                variable_name: "order_id",
                value: order.id,
              },
            ],
          },
        });

        // Cache initialization response for short period to allow idempotency
        await redis.set(
          cacheKey,
          JSON.stringify({
            authorization_url: init.authorization_url,
            reference: init.reference,
          }),
          { ex: 600 },
        );

        // 4. Create or update payment record
        let payment;
        if (existingPayment) {
          payment = await tx.payment.update({
            where: { id: existingPayment.id },
            data: {
              transactionId: init.reference,
              method: "PAYSTACK",
              status: "PENDING",
            },
          });
        } else {
          payment = await tx.payment.create({
            data: {
              orderId: order.id,
              userId: actor.id,
              amount: order.totalAmount,
              status: "PENDING",
              method: "PAYSTACK",
              transactionId: init.reference,
            },
          });
        }

        // 5. Update order payment status (keep as PENDING until verification)
        await tx.order.update({
          where: { id: order.id },
          data: { paymentStatus: "PENDING" },
        });

        return {
          paymentId: payment.id,
          authorization_url: init.authorization_url,
        };
      } finally {
        // release the lock (best-effort)
        await redis.del(lockKey);
      }
    });

    return sendSuccess(res, {
      ...result,
      message: "Payment initialized successfully",
    });
  } catch (error: any) {
    console.error("Payment intent error:", error);
    return handleError(res, error);
  }
};

// POST /orders/:reference/payments/confirm
export const confirmPayment = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Payment']
   * #swagger.summary = 'Confirm a payment'
   * #swagger.description = 'Confirms a payment using the payment reference.'
   * #swagger.security = [{ "bearerAuth": [] }]
   * #swagger.parameters['body'] = { in: 'body', description: 'Payment reference', required: true, schema: { type: 'object', properties: { reference: { type: 'string' } } } }
   */
  try {
    const { reference } = req.body;
    const actor = getActorFromReq(req);

    if (!actor) throw new AppError(401, "Unauthorized");
    if (!reference) throw new AppError(400, "Payment reference is required");

    const result = await prisma.$transaction(async (tx) => {
      // 1. Verify payment exists
      const payment = await tx.payment.findFirst({
        where: {
          transactionId: reference,
          userId: actor.id,
        },
        include: {
          order: true,
        },
      });

      if (!payment) {
        throw new AppError(404, "Payment not found");
      }

      // 2. Verify with Paystack via helper
      const verifyResponse = await paystack.verifyTransaction(reference);
      const paymentData = verifyResponse.raw;
      // paystack returns amount in kobo (minor unit) — verify it matches our stored amount
      // (ensure consistent units: if payment.amount is Naira, convert)
      const paystackAmountKobo = Number(paymentData.amount || 0);
      const expectedKobo = Math.round(payment.amount * 100);
      if (paystackAmountKobo && paystackAmountKobo !== expectedKobo) {
        throw new AppError(400, "Payment amount mismatch");
      }
      // Map Paystack status to our Prisma PaymentStatus enum
      const status = paymentData.status === "success" ? "SUCCESSFUL" : "FAILED";

      // 3. Update payment record
      const updatedPayment = await tx.payment.update({
        where: { id: payment.id },
        data: {
          status,
          paidAt: status === "SUCCESSFUL" ? new Date() : undefined,
        },
      });

      // 4. Update order status (on success we mark order ACCEPTED, otherwise leave as-is)
      const orderUpdateData: Prisma.OrderUpdateInput = {
        paymentStatus: status,
      };
      if (status === "SUCCESSFUL") orderUpdateData.status = "ACCEPTED";

      await tx.order.update({
        where: { id: payment.orderId },
        data: orderUpdateData,
      });

      // 5. Create order history entry
      await tx.orderHistory.create({
        data: {
          orderId: payment.orderId,
          status: status === "SUCCESSFUL" ? "ACCEPTED" : "PENDING",
          actorId: actor.id,
          actorType: "SYSTEM",
          note: `Payment ${status.toLowerCase()} - Reference: ${reference}`,
        },
      });

      return { status, payment: updatedPayment };
    });

    // Emit order update after transaction completes
    try {
      socketService.emitOrderUpdate({
        orderId: result.payment.orderId,
        paymentStatus: result.status,
      });
    } catch (e: Error | any) {
      console.warn("Failed to emit order update:", e?.message || e);
    }

    return sendSuccess(res, {
      ...result,
      message: `Payment ${result.status.toLowerCase()} successfully`,
    });
  } catch (error: any) {
    console.error("Payment confirmation error:", error);
    return handleError(res, error);
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

// POST /orders/:id/payments/refund
export const processRefund = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Payment']
   * #swagger.summary = 'Process a refund'
   * #swagger.description = 'Processes a refund for an order. Only admins can perform this action.'
   * #swagger.security = [{ "bearerAuth": [] }]
   * #swagger.parameters['id'] = { in: 'path', description: 'Order ID', required: true, type: 'string' }
   * #swagger.parameters['body'] = { in: 'body', description: 'Refund details', required: true, schema: { type: 'object', properties: { reason: { type: 'string' }, amount: { type: 'number' } } } }
   */
  try {
    const { id: orderId } = req.params;
    const { reason, amount } = req.body;
    const actor = getActorFromReq(req);

    if (!actor) throw new AppError(401, "Unauthorized");
    const role = String(actor.role || "").toLowerCase();
    if (role !== "admin") throw new AppError(403, "Unauthorized");
    if (!reason) throw new AppError(400, "Refund reason is required");

    const result = await prisma.$transaction(async (tx) => {
      // 1. Fetch payment and verify status
      const payment = await tx.payment.findFirst({
        where: {
          orderId,
          status: "SUCCESSFUL",
        },
        include: {
          order: {
            select: {
              id: true,
              status: true,
              totalAmount: true,
              customerId: true,
            },
          },
        },
      });

      if (!payment) {
        throw new AppError(404, "No completed payment found for this order");
      }

      const refundAmount = amount || payment.amount;
      if (refundAmount > payment.amount) {
        throw new AppError(400, "Refund amount cannot exceed payment amount");
      }
      // 2. Ensure we have a transaction id
      if (!payment.transactionId)
        throw new AppError(400, "No transaction id available for this payment");

      // 3. Initialize refund with Paystack via helper
      const refundResponse = await paystack.refundTransaction(
        payment.transactionId,
        refundAmount,
      );

      // 4. Update payment & order records accordingly (no Refund model in schema)
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: "REFUNDED" },
      });

      await tx.order.update({
        where: { id: orderId },
        data: {
          status: "CANCELLED",
          paymentStatus: "REFUNDED",
        },
      });

      // 5. Create order history entry
      await tx.orderHistory.create({
        data: {
          orderId,
          status: "CANCELLED",
          actorId: actor.id,
          actorType: "admin",
          note: `Refund initiated: ${reason}`,
        },
      });

      return { refund: refundResponse.raw };
    });

    // Emit order update
    try {
      socketService.emitOrderUpdate({
        orderId,
        status: "CANCELLED",
        paymentStatus: "REFUNDED",
      });
    } catch (e: Error | any) {
      console.warn("Failed to emit order update:", e?.message || e);
    }

    return sendSuccess(res, {
      ...result,
      message: "Refund initiated successfully",
    });
  } catch (error: any) {
    console.error("Refund processing error:", error);
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

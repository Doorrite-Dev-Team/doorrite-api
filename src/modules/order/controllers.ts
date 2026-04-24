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
import { cacheService } from "@config/cache";
import { Pagination } from "types/types";
import { Order } from "../../generated/prisma";
import { calculateDeliveryFee } from "@lib/utils/location";
import { PendingReviewService } from "@services/redis/pending-review";
import { CancellationPolicyService } from "@services/cancellation-policy";
import { RefundService } from "@services/refund-service";
import {
  deductVendorEarnings,
  creditVendorEarnings,
  calculateEarnings,
  createEarningsRecord,
  settleRiderEarnings,
} from "@services/earnings";
import { pushService } from "@modules/push/push.service";
import { isEligibleForFreeDelivery, useFreeDelivery } from "@modules/referral/referral.service";

// GET api/v1/orders?status=&vendorId=&customerId=&page=&limit=&from=&to=
export const getOrders = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Order']
   * #swagger.summary = 'Get orders'
   * #swagger.description = 'Get all orders'
   * #swagger.operationId = 'getOrders'
   * #swagger.security = [{ "bearerAuth": [] }]
   * #swagger.parameters['page'] = { in: 'query', description: 'Page number', required: false, type: 'integer', example: 1 }
   * #swagger.parameters['limit'] = { in: 'query', description: 'Number of items per page', required: false, type: 'integer', example: 20 }
   * #swagger.parameters['status'] = { in: 'query', description: 'Filter by order status', required: false, type: 'string', example: 'PENDING' }
   * #swagger.responses[200] = { description: 'Orders retrieved successfully', schema: { type: 'object', properties: { orders: { type: 'array' }, total: { type: 'integer' }, page: { type: 'integer' }, limit: { type: 'integer' } } }}
   * #swagger.responses[401] = { description: 'Unauthorized', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
   * #swagger.responses[403] = { description: 'Forbidden', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
   * #swagger.responses[500] = { description: 'Internal server error', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
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
   * #swagger.operationId = 'getOrderById'
   * #swagger.security = [{ "bearerAuth": [] }]
   * #swagger.parameters['id'] = { in: 'path', description: 'Order ID', required: true, type: 'string', example: 'order_123' }
   * #swagger.responses[200] = { description: 'Order retrieved successfully', schema: { type: 'object', properties: { order: { type: 'object' } } } }
   * #swagger.responses[400] = { description: 'Invalid order ID', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
   * #swagger.responses[401] = { description: 'Unauthorized', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
   * #swagger.responses[404] = { description: 'Order not found', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
   * #swagger.responses[500] = { description: 'Internal server error', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
   */
  const { id } = req.params;

  try {
    if (!id) throw new AppError(400, "Order id is required");

    const actor = getActorFromReq(req);
    if (!actor) throw new AppError(401, "Unauthorized");

    const key = cacheService.generateKey("orders", id);
    const cacheHit = await cacheService.get<{ order: Order }>(key);

    if (cacheHit) {
      console.debug(
        "--------------------------------Cache----------------------------",
      );
      return sendSuccess(res, cacheHit);
    }

    console.debug(
      "--------------------------------Missed----------------------------",
    );

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
    console.debug(
      "--------------------------------Adding to Cache----------------------------",
    );
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
   * #swagger.operationId = 'createOrder'
   * #swagger.security = [{ "bearerAuth": [] }]
   * #swagger.requestBody = { description: 'Order data', required: true, schema: { type: 'object', required: ['vendorId', 'items', 'contactInfo', 'deliveryAddress', 'paymentMethod'], properties: { vendorId: { type: 'string' }, items: { type: 'array' }, contactInfo: { type: 'object' }, deliveryAddress: { type: 'object' }, paymentMethod: { type: 'string', enum: ['COD', 'PAYSTACK'] } } } }
   * #swagger.responses[201] = { description: 'Order created successfully', schema: { type: 'object', properties: { ok: { type: 'boolean' }, data: { type: 'object' } } } }
   * #swagger.responses[400] = { description: 'Validation error', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
   * #swagger.responses[401] = { description: 'Unauthorized', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
   * #swagger.responses[404] = { description: 'Vendor or product not found', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
   * #swagger.responses[500] = { description: 'Internal server error', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
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

      // Prepare order items first (validates products, modifiers, calculates modifiersTotal)
      const prepareOrderItems = async () =>
        Promise.all(
          items.map(async (item) => {
            const {
              productId,
              variantId,
              quantity = 1,
              modifiers,
            } = item as any;

            // ✅ Fetch product
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
              throw new AppError(400, `Product does not belong to vendor`);
            if (!product.isAvailable)
              throw new AppError(400, `Product ${productId} is not available`);

            // ✅ Fetch variant if specified
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
                  throw new AppError(400, `Insufficient stock`);
                await tx.productVariant.update({
                  where: { id: variantId },
                  data: { stock: variant.stock - quantity },
                });
              }
            }

            const basePrice = variant ? variant.price : product.basePrice;

            // ✅ VALIDATE AND PROCESS MODIFIERS
            let modifiersTotal = 0;
            const modifierData: any[] = [];

            if (modifiers && modifiers.length > 0) {
              // Fetch product's assigned modifier groups
              const assignedGroups = await tx.productModifierGroup.findMany({
                where: { productId },
                include: {
                  modifierGroup: {
                    include: {
                      options: { where: { isAvailable: true } },
                    },
                  },
                },
              });

              const groupMap = new Map(
                assignedGroups.map((ag) => [
                  ag.modifierGroupId,
                  ag.modifierGroup,
                ]),
              );

              // Validate each modifier selection
              for (const modSelection of modifiers) {
                const { modifierGroupId, selectedOptions } = modSelection;

                const group = groupMap.get(modifierGroupId);
                if (!group) {
                  throw new AppError(
                    400,
                    `Modifier group ${modifierGroupId} not assigned to product`,
                  );
                }

                // Validate selection count
                const optionCount = selectedOptions.length;

                if (group.isRequired && optionCount < group.minSelect) {
                  throw new AppError(
                    400,
                    `${group.name} requires at least ${group.minSelect} selection(s)`,
                  );
                }

                if (optionCount > group.maxSelect) {
                  throw new AppError(
                    400,
                    `${group.name} allows maximum ${group.maxSelect} selection(s)`,
                  );
                }

                // Process each selected option
                for (const selection of selectedOptions) {
                  const { modifierOptionId, quantity: modQty = 1 } = selection;

                  const option = group.options.find(
                    (o) => o.id === modifierOptionId,
                  );

                  if (!option) {
                    throw new AppError(
                      400,
                      `Invalid option ${modifierOptionId}`,
                    );
                  }

                  if (!option.isAvailable) {
                    throw new AppError(400, `${option.name} is not available`);
                  }

                  const optionTotal = option.priceAdjustment * modQty;
                  modifiersTotal += optionTotal;

                  modifierData.push({
                    modifierOptionId: option.id,
                    groupName: group.name,
                    optionName: option.name,
                    priceAdjustment: option.priceAdjustment,
                    quantity: modQty,
                  });
                }
              }
            }

            // ✅ Validate required modifiers
            const requiredGroups = await tx.productModifierGroup.findMany({
              where: {
                productId,
                modifierGroup: { isRequired: true },
              },
              select: {
                modifierGroupId: true,
                modifierGroup: { select: { name: true } },
              },
            });

            const providedGroupIds = new Set(
              (modifiers || []).map((m: any) => m.modifierGroupId),
            );

            for (const reqGroup of requiredGroups) {
              if (!providedGroupIds.has(reqGroup.modifierGroupId)) {
                throw new AppError(
                  400,
                  `${reqGroup.modifierGroup.name} is required`,
                );
              }
            }

            // ✅ Return order item
            return {
              productId,
              variantId: variantId || undefined,
              quantity,
              price: basePrice,
              modifiersTotal,
              modifiers: {
                create: modifierData,
              },
            };
          }),
        );

      // Execute prepareOrderItems to validate and get totals
      const preparedItems = await prepareOrderItems();

      // Calculate total from prepared items (base prices + modifiers)
      const itemsSubtotal = preparedItems.reduce((sum, item) => {
        return sum + item.price * item.quantity + item.modifiersTotal;
      }, 0);

      const deliveryFee = calculateDeliveryFee(
        vendor,
        deliveryAddress.coordinates?.lat,
        deliveryAddress.coordinates?.long,
      );

      // 10% vendor commission on items only
      const itemsWithCommission = itemsSubtotal * 1.1;

      // Small order fee: ₦200 if items subtotal is under ₦2,000
      const smallOrderFee = itemsSubtotal < 2000 ? 200 : 0;

      const totalKobo = Math.round(
        (itemsWithCommission + deliveryFee + smallOrderFee) * 100,
      );
      const totalAmount = Math.round((totalKobo / 100) * 100) / 100;

      // Determine initial status based on payment method
      const initialStatus =
        paymentMethod === "PAYSTACK" ? "PENDING_PAYMENT" : "PENDING";

      const order = await tx.order.create({
        data: {
          customerId,
          vendorId,
          deliveryAddress,
          contactInfo,
          totalAmount,
          status: initialStatus,
          paymentStatus: "PENDING",
          // items: {
          //   create: await Promise.all(
          //     items.map(async (item) => {
          //       const { productId, variantId, quantity = 1 } = item as any;

          //       const product = await tx.product.findUnique({
          //         where: { id: productId },
          //         select: {
          //           id: true,
          //           vendorId: true,
          //           isAvailable: true,
          //           basePrice: true,
          //         },
          //       });

          //       if (!product)
          //         throw new AppError(404, `Product ${productId} not found`);
          //       if (product.vendorId !== vendorId)
          //         throw new AppError(
          //           400,
          //           `Product ${productId} does not belong to vendor`,
          //         );
          //       if (!product.isAvailable)
          //         throw new AppError(
          //           400,
          //           `Product ${productId} is not available`,
          //         );

          //       let variant: any = null;
          //       if (variantId) {
          //         variant = await tx.productVariant.findUnique({
          //           where: { id: variantId },
          //         });
          //         if (!variant || variant.productId !== productId)
          //           throw new AppError(404, `Variant ${variantId} not found`);
          //         if (!variant.isAvailable)
          //           throw new AppError(
          //             400,
          //             `Variant ${variantId} is not available`,
          //           );

          //         if (typeof variant.stock === "number") {
          //           if (variant.stock < quantity)
          //             throw new AppError(
          //               400,
          //               `Insufficient stock for variant ${variantId}`,
          //             );
          //           await tx.productVariant.update({
          //             where: { id: variantId },
          //             data: { stock: variant.stock - quantity },
          //           });
          //         }
          //       }

          //       const price = variant
          //         ? variant.price
          //         : (product.basePrice ?? 0);

          //       return {
          //         productId,
          //         variantId: variantId || undefined,
          //         quantity,
          //         price,
          //         // unitPrice: price,
          //         // subtotal: price * quantity,
          //       };
          //     }),
          //   ),
          // },
          // Inside createOrder, replace the items creation section:

          items: {
            create: await prepareOrderItems(),
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

      // Push notification to vendor about new order
      pushService.sendToVendor(vendorId, {
        title: "New Order Received",
        body: `New order from ${customer.fullName} - ₦${order.totalAmount}`,
        tag: `new-order-${order.id}`,
        data: {
          orderId: order.id,
          customerId: customerId,
          amount: order.totalAmount,
        },
      }).catch((err) => console.error("Push notification to vendor failed:", err));

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
   * #swagger.description = 'Cancel an order (User/Vendor/Admin only).'
   * #swagger.operationId = 'cancelOrder'
   * #swagger.security = [{ "bearerAuth": [] }]
   * #swagger.parameters['id'] = { in: 'path', description: 'Order ID', required: true, type: 'string', example: 'order_123' }
   * #swagger.requestBody = { description: 'Cancellation reason', required: true, schema: { type: 'object', required: ['reason'], properties: { reason: { type: 'string' } } } }
   * #swagger.responses[200] = { description: 'Order cancelled successfully', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } } }
   * #swagger.responses[400] = { description: 'Invalid request', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
   * #swagger.responses[401] = { description: 'Unauthorized', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
   * #swagger.responses[403] = { description: 'Cannot cancel this order', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
   * #swagger.responses[404] = { description: 'Order not found', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
   * #swagger.responses[500] = { description: 'Internal server error', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
   */
  const { id } = req.params;
  const reason = req.body?.reason;
  const actor = getActorFromReq(req);

  try {
    if (!id) throw new AppError(400, "Order id is required");
    if (!reason) throw new AppError(400, "Cancellation reason is required");
    if (!actor) throw new AppError(401, "Unauthorized");

    // 1. Role-based Authorization
    const allowedRoles = ["user", "admin", "vendor"];
    const actorRole = actor.role || "";
    if (!allowedRoles.includes(actorRole)) {
      throw new AppError(403, "Only customers, vendors and admins can cancel orders");
    }

    // 2. Idempotency Check
    const existingCancellation = await prisma.orderHistory.findFirst({
      where: {
        orderId: id,
        status: "CANCELLED",
        createdAt: { gt: new Date(Date.now() - 5 * 60 * 1000) },
      },
    });
    if (existingCancellation) {
      return sendSuccess(res, {
        message: "Order already cancelled",
        cancelledAt: existingCancellation.createdAt,
        cancelledBy: existingCancellation.actorType,
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id },
        include: {
          items: true,
          customer: true,
          vendor: true,
          rider: true,
          payment: true,
        },
      });

      if (!order) throw new AppError(404, "Order not found");

      // 3. Ownership Validation
      if (actor.role === "user" && order.customerId !== actor.id) {
        throw new AppError(403, "You can only cancel your own orders");
      }
      if (actor.role === "vendor" && order.vendorId !== actor.id) {
        throw new AppError(403, "Vendors can only cancel their own orders");
      }

      // 4. Status Check via Policy Service
      const rule = CancellationPolicyService.getRule(order.status);
      if (!rule.canCancel) {
        throw new AppError(400, rule.reason);
      }

      const finalStatus = "CANCELLED" as const;
      const customerName = order.customer?.fullName || "Customer";
      const vendorName = order.vendor?.businessName || "Vendor";
      
      const actorName = actor.role === "admin" ? "Admin" : 
                       actor.role === "vendor" ? vendorName : 
                       customerName;

      let cancellationNote = `Order cancelled by ${actorName}. Reason: ${reason}`;
      if (rule.fee > 0) {
        cancellationNote += `. ₦${rule.fee} cancellation fee applies.`;
      }

      // 5. Order Update
      const updatedOrder = await tx.order.update({
        where: { id },
        data: { status: finalStatus },
        include: {
          items: { include: { product: true, variant: true } },
          customer: { select: { id: true, fullName: true, email: true } },
          vendor: { select: { id: true, businessName: true } },
          rider: { select: { id: true, fullName: true } },
        },
      });

      // 6. Audit Trail
      await tx.orderHistory.create({
        data: {
          orderId: updatedOrder.id,
          status: finalStatus,
          actorId: actor.id,
          actorType: actor.role === "admin" ? "ADMIN" : 
                     actor.role === "vendor" ? "VENDOR" : "USER",
          note: cancellationNote,
        },
      });

      // 7. Stock Restoration
      if (rule.restoreStock) {
        for (const item of order.items) {
          if (item.variantId) {
            await tx.productVariant.update({
              where: { id: item.variantId },
              data: { stock: { increment: item.quantity } },
            });
          }
        }
      }

      // 8. Financials & Payment
      if (order.payment) {
        const refundResult = await RefundService.processCancellationRefund(
          id,
          order.payment,
          rule.fee,
          reason,
          { id: actor.id, role: actor.role || "" },
          tx
        );
        
        if (refundResult.status === "COMPLETED") {
          await tx.payment.update({
            where: { id: order.payment.id },
            data: { status: "REFUNDED" },
          });
        }
      }

      return {
        order: updatedOrder,
        cancellationFee: rule.fee,
      };
    });

    const order = result.order;
    const cancellationFee = result.cancellationFee;

    // 9. Notifications
    const notificationRecipients = [
      order.vendorId,
      order.customerId,
      order.rider?.id,
    ].filter(Boolean) as string[];

    const cancellerName = actor.role === "admin" ? "Admin" : 
                          actor.role === "vendor" ? "Vendor" : 
                          order.customer?.fullName || "Customer";

    socketService.notifyTo(
      notificationRecipients,
      AppSocketEvent.NOTIFICATION,
      {
        title: `Order Cancelled: ${order.id}`,
        type: "ORDER_CANCELLED",
        message: `${cancellerName} cancelled order: ${order.id}`,
        priority: "high",
        metadata: {
          orderId: order.id,
          vendorId: order.vendorId,
          actionUrl: `/orders/${order.id}`,
          cancelledBy: actor.role,
          cancellationFee,
        },
        timestamp: order.updatedAt.toISOString(),
      },
    );

    // 10. Cache Invalidation
    await cacheService.invalidatePattern("orders");
    await cacheService.invalidatePattern("userOrders");
    await cacheService.invalidatePattern("vendors");

    return sendSuccess(res, {
      order,
      message: cancellationFee > 0
        ? `Order cancelled successfully. Cancellation fee of ₦${cancellationFee} applies. Refund will be processed manually within 24 hours.`
        : "Order cancelled successfully",
      cancellationFee,
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
   * #swagger.operationId = 'checkPaymentStatus'
   * #swagger.security = [{ "bearerAuth": [] }]
   * #swagger.parameters['id'] = { in: 'path', description: 'Order ID', required: true, type: 'string', example: 'order_123' }
   * #swagger.responses[200] = { description: 'Payment status retrieved', schema: { type: 'object', properties: { paymentStatus: { type: 'string' } } } }
   * #swagger.responses[401] = { description: 'Unauthorized', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
   * #swagger.responses[404] = { description: 'Order not found', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
   * #swagger.responses[500] = { description: 'Internal server error', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
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
   * #swagger.tags = ['Order']
   * #swagger.summary = 'Get 6 digit delivery verification code'
   * #swagger.description = 'Used by the customer to get the code to show the rider.'
   * #swagger.operationId = 'getCustomerVerificationCode'
   * #swagger.security = [{ "bearerAuth": [] }]
   * #swagger.parameters['orderId'] = { in: 'path', description: 'Order ID', required: true, type: 'string', example: 'order_123' }
   * #swagger.responses[200] = { description: 'Verification code retrieved', schema: { type: 'object', properties: { verificationCode: { type: 'string' } } } }
   * #swagger.responses[400] = { description: 'Invalid request', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
   * #swagger.responses[401] = { description: 'Unauthorized', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
   * #swagger.responses[404] = { description: 'Order not found', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
   * #swagger.responses[500] = { description: 'Internal server error', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
   */

  try {
    const { id: orderId } = req.params;
    const actor = getActorFromReq(req);

    if (!orderId) throw new AppError(400, "Order ID is required");
    if (!actor) throw new AppError(401, "Unauthorized");
    const role = String(actor.role || "").toUpperCase();
    if (role !== "CUSTOMER" && role !== "USER" && role !== "ADMIN")
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

export const verifyDeliveryByUser = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Order']
   * #swagger.summary = 'Verify delivery using 6 digit code from rider'
   * #swagger.description = 'Used by the customer to verify delivery by entering code from rider.'
   * #swagger.operationId = 'verifyDeliveryByUser'
   * #swagger.security = [{ "bearerAuth": [] }]
   * #swagger.parameters['orderId'] = { in: 'path', description: 'Order ID', required: true, type: 'string', example: 'order_123' }
   * #swagger.requestBody = { description: 'Verification code from rider', required: true, schema: { type: 'object', required: ['verificationCode'], properties: { verificationCode: { type: 'string', example: '123456' } } } }
   * #swagger.responses[200] = { description: 'Delivery verified successfully', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } } }
   * #swagger.responses[400] = { description: 'Invalid code or request', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
   * #swagger.responses[401] = { description: 'Unauthorized', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
   * #swagger.responses[404] = { description: 'Order not found', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
   * #swagger.responses[500] = { description: 'Internal server error', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
   */

  try {
    const { id: orderId } = req.params;
    const { verificationCode } = req.body;
    const actor = getActorFromReq(req);

    if (!orderId) throw new AppError(400, "Order ID is required");
    if (!verificationCode)
      throw new AppError(400, "Verification code is required");
    if (!actor) throw new AppError(401, "Unauthorized");
    const role = String(actor.role || "").toUpperCase();
    if (role !== "CUSTOMER" && role !== "USER" && role !== "ADMIN")
      throw new AppError(403, "Only customers can verify delivery");

    const order = await prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) throw new AppError(404, "Order not found");
    if (order.customerId !== actor.id)
      throw new AppError(403, "You are not authorized to verify this order");

    if (order.status !== "OUT_FOR_DELIVERY") {
      throw new AppError(
        400,
        "This order is not currently out for delivery. Current status: " +
          order.status,
      );
    }

    if (!order.deliveryVerificationCode) {
      throw new AppError(
        500,
        "Verification code has not been generated for this order.",
      );
    }

    if (order.deliveryVerificationCode !== verificationCode) {
      throw new AppError(400, "Invalid verification code");
    }

    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data: {
        status: "DELIVERED",
        deliveryVerificationCode: null,
      },
    });

    socketService.notify(order.customerId, AppSocketEvent.ORDER_DELIVERED, {
      title: "Order Delivered",
      type: "ORDER_DELIVERED",
      message: `Your order has been confirmed as delivered!`,
      priority: "high",
      metadata: {
        orderId: updatedOrder.id,
        vendorId: updatedOrder.vendorId,
      },
      timestamp: new Date().toISOString(),
    });

    // Settle rider earnings (move pending to available balance)
    if (order.riderId) {
      try {
        await settleRiderEarnings(orderId);
        console.log(
          "[DELIVERY_VERIFY] Rider earnings settled for order:",
          orderId,
        );
      } catch (earningsError) {
        console.error(
          "[DELIVERY_VERIFY] Failed to settle rider earnings:",
          earningsError,
        );
      }
    }

    await PendingReviewService.add(orderId, order.customerId);

    await cacheService.invalidatePattern("orders");
    await cacheService.invalidatePattern("userOrders");

    return sendSuccess(res, { message: "Delivery successfully verified" });
  } catch (error) {
    handleError(res, error);
  }
};

// GET /orders/pending-review
export const getPendingReviews = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.sub;
    if (!userId) throw new AppError(401, "Unauthorized");

    return sendSuccess(res, { orders: [] });
  } catch (error) {
    handleError(res, error);
  }
};

// GET /orders/:id/messages
export const getOrderMessages = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.sub;
    if (!userId) throw new AppError(401, "Unauthorized");

    const { id: orderId } = req.params;
    const { limit = "50", before } = req.query;

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, customerId: true, riderId: true },
    });

    if (!order) {
      throw new AppError(404, "Order not found");
    }

    const isAuthorized =
      order.customerId === userId || order.riderId === userId;
    if (!isAuthorized) {
      throw new AppError(403, "Not authorized to view this order's messages");
    }

    const where: any = { orderId };
    if (before) {
      where.createdAt = { lt: new Date(before as string) };
    }

    const messages = await prisma.message.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: parseInt(limit as string, 10) || 50,
    });

    return sendSuccess(res, { messages: messages.reverse() });
  } catch (error) {
    handleError(res, error);
  }
};

// POST /orders/:id/messages
export const sendOrderMessage = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.sub;
    if (!userId) throw new AppError(401, "Unauthorized");

    const { id: orderId } = req.params;
    const { content } = req.body;

    if (!content?.trim()) {
      throw new AppError(400, "Message content is required");
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, customerId: true, riderId: true },
    });

    if (!order) {
      throw new AppError(404, "Order not found");
    }

    const isAuthorized = order.customerId === userId || order.riderId === userId;
    if (!isAuthorized) {
      throw new AppError(403, "Not authorized to send messages for this order");
    }

    const senderType = order.customerId === userId ? "customer" : "rider";

    const message = await prisma.message.create({
      data: {
        content: content.trim(),
        senderId: userId,
        senderType,
        orderId,
      },
    });

    return sendSuccess(res, { message }, 201);
  } catch (error) {
    handleError(res, error);
  }
};

// POST /api/v1/orders/:id/reorder
export const reorder = async (req: Request, res: Response) => {
  /**
   * #swagger.tags = ['Order']
   * #swagger.summary = 'Reorder'
   * #swagger.description = 'Create a new order by reordering from an existing order'
   * #swagger.operationId = 'reorder'
   * #swagger.security = [{ "bearerAuth": [] }]
   * #swagger.parameters['id'] = { in: 'path', description: 'Order ID', required: true, type: 'string', example: 'order_123' }
   * #swagger.responses[201] = { description: 'Order created successfully', schema: { type: 'object', properties: { ok: { type: 'boolean' }, data: { type: 'object' } } } }
   * #swagger.responses[400] = { description: 'Invalid request', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
   * #swagger.responses[401] = { description: 'Unauthorized', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
   * #swagger.responses[404] = { description: 'Order not found', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
   * #swagger.responses[500] = { description: 'Internal server error', schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } }}
   */
  try {
    const { id: orderId } = req.params;

    const actor = getActorFromReq(req);
    if (!actor || !actor.id) throw new AppError(401, "Unauthorized");

    const result = await prisma.$transaction(async (tx) => {
      const originalOrder = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          items: {
            include: {
              product: true,
              variant: true,
              modifiers: true,
            },
          },
          vendor: true,
          delivery: true,
        },
      });

      if (!originalOrder) {
        throw new AppError(404, "Order not found");
      }

      if (originalOrder.customerId !== actor.id) {
        throw new AppError(403, "You can only reorder your own orders");
      }

      if (!originalOrder.vendor.isActive) {
        throw new AppError(400, "Vendor is no longer available");
      }

      const availableItems = originalOrder.items.filter(
        (item) => item.product.isAvailable && (item.variant?.isAvailable ?? true)
      );

      if (availableItems.length === 0) {
        throw new AppError(400, "No items available for reorder");
      }

      const itemsSubtotal = availableItems.reduce((sum, item) => {
        const currentPrice = item.variant?.price ?? item.product.basePrice;
        return sum + currentPrice * item.quantity;
      }, 0);

      const deliveryFee = calculateDeliveryFee(
        originalOrder.vendor,
        originalOrder.deliveryAddress.coordinates?.lat,
        originalOrder.deliveryAddress.coordinates?.long
      );

      const itemsWithCommission = itemsSubtotal * 1.1;
      const smallOrderFee = itemsSubtotal < 2000 ? 200 : 0;
      const totalAmount = Math.round((itemsWithCommission + deliveryFee + smallOrderFee) * 100) / 100;

      const newOrder = await tx.order.create({
        data: {
          customerId: actor.id,
          vendorId: originalOrder.vendorId,
          contactInfo: originalOrder.contactInfo,
          deliveryAddress: originalOrder.deliveryAddress,
          totalAmount,
          status: "PENDING",
          paymentStatus: "PENDING",
          originalOrderId: orderId,
          items: {
            create: await Promise.all(
              availableItems.map(async (item) => {
                const currentPrice = item.variant?.price ?? item.product.basePrice;

                const variant = item.variantId
                  ? await tx.productVariant.findUnique({
                      where: { id: item.variantId },
                    })
                  : null;

                if (variant && typeof variant.stock === "number") {
                  if (variant.stock < item.quantity) {
                    throw new AppError(400, `Insufficient stock for ${item.product.name}`);
                  }
                  await tx.productVariant.update({
                    where: { id: item.variantId! },
                    data: { stock: variant.stock - item.quantity },
                  });
                }

                return {
                  productId: item.productId,
                  variantId: item.variantId || undefined,
                  quantity: item.quantity,
                  price: currentPrice,
                  modifiersTotal: item.modifiersTotal,
                  modifiers: {
                    create: item.modifiers.map((mod) => ({
                      modifierOptionId: mod.modifierOptionId,
                      quantity: mod.quantity,
                      groupName: mod.groupName,
                      optionName: mod.optionName,
                      priceAdjustment: mod.priceAdjustment,
                    })),
                  },
                };
              })
            ),
          },
        },
        include: {
          items: { include: { product: true, variant: true } },
          vendor: { select: { id: true, businessName: true } },
          customer: { select: { id: true, fullName: true, email: true } },
        },
      });

      await tx.order.update({
        where: { id: orderId },
        data: { reorderCount: { increment: 1 } },
      });

      return newOrder;
    });

    return sendSuccess(res, { order: result });
  } catch (error) {
    handleError(res, error);
  }
};

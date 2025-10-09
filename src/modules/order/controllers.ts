import { AppError, handleError, sendSuccess } from "@lib/utils/AppError";
import { getActorFromReq } from "@lib/utils/req-res";
import {
  calculateOrderTotal,
  getCustomerIdFromRequest,
  validateCreateOrderBody,
} from "@modules/order/utils";
import { Request, Response } from "express";
import prisma from "@config/db";
import socketService from "@lib/socketService";

// GET api/v1/orders?status=&vendorId=&customerId=&page=&limit=&from=&to=
export const getOrders = async (req: Request, res: Response) => {
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
  try {
    const { vendorId, items, deliveryAddress, paymentMethod, placeId } =
      validateCreateOrderBody(req.body || {});
    const customerId = getCustomerIdFromRequest(req);

    const result = await prisma.$transaction(async (tx) => {
      // 1. Verify vendor exists
      const vendor = await tx.vendor.findUnique({
        where: { id: vendorId },
      });
      if (!vendor) {
        throw new AppError(404, "Vendor not found");
      }

      // 2. Verify customer exists
      const customer = await tx.user.findUnique({
        where: { id: customerId },
      });
      if (!customer) {
        throw new AppError(404, "Customer not found");
      }

      // 3. Calculate total amount
      const totalAmount = await calculateOrderTotal(items);

      // 4. Create the order
      const computedAddress =
        (deliveryAddress as any)?.address &&
        (deliveryAddress as any).address.trim().length > 0
          ? (deliveryAddress as any).address
          : `${deliveryAddress.street || ""} ${deliveryAddress.city || ""} ${
              deliveryAddress.lga || ""
            }`.trim() || placeId;

      const order = await tx.order.create({
        data: {
          customerId,
          vendorId,
          // Persist deliveryAddress with placeId for mapping/tracking
          deliveryAddress: {
            ...deliveryAddress,
            address: computedAddress,
            placeId,
          },
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

                if (!product) {
                  throw new AppError(
                    404,
                    `Product ${item.productId} not found`
                  );
                }

                // If variant specified, validate and use its price
                let price = product.basePrice;
                if (item.variantId) {
                  const variant = product.variants.find(
                    (v) => v.id === item.variantId
                  );
                  if (!variant) {
                    throw new AppError(
                      404,
                      `Variant ${item.variantId} not found for product ${item.productId}`
                    );
                  }
                  price = variant.price;
                }

                return {
                  productId: item.productId,
                  variantId: item.variantId,
                  quantity: item.quantity,
                  price: price, // Add this if 'price' is required by your Prisma schema
                  unitPrice: price,
                  subtotal: price * item.quantity,
                  // If 'product' relation is required, add: product: { connect: { id: item.productId } }
                };
              })
            ),
          },
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
        },
      });

      // 5. Create payment record if using PAYSTACK
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

      // 6. Create order history entry
      await tx.orderHistory.create({
        data: {
          orderId: order.id,
          status: "PENDING",
          actorId: customerId,
          actorType: "SYSTEM",
          note: "Order created and placed",
        },
      });

      const resultObj = { order, payment };
      // Emit order created
      socketService.emitOrderUpdate(resultObj.order);
      return resultObj;
    });

    return sendSuccess(
      res,
      {
        order: result?.order,
        payment: result?.payment,
        nextAction: result?.payment
          ? "INITIALIZE_PAYSTACK_PAYMENT"
          : "ORDER_PLACED_COD",
      },
      201
    );
  } catch (error: any) {
    console.error("Error creating order:", error);
    handleError(res, error);
  }
};

// PATCH /orders/:orderId/cancel - Cancel order
export const cancelOrder = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { reason } = req.body;
  const actor = getActorFromReq(req);
  const customerId = getCustomerIdFromRequest(req);
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

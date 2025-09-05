import { AppError, handleError, sendSuccess } from "@lib/utils/AppError";
import { getActorFromReq } from "@lib/utils/req-res";
import {
  calculateOrderTotal,
  getCustomerIdFromRequest,
  validateCreateOrderBody,
} from "@modules/order/utils";
import { Request, Response } from "express";

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
      claimable,
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
        // allow vendor to filter by customer via query only if provided
        if (customerId) where.customerId = customerId;
        break;
      case "RIDER":
        // rider sees orders assigned to them.
        // If claimable=true, show orders that are claimable (no rider assigned & status in ACCEPTED|PREPARING)
        if (claimable === "true") {
          where.riderId = null;
          where.status = { in: ["ACCEPTED", "PREPARING"] };
        } else {
          where.riderId = actor.id;
        }
        break;
      case "ADMIN":
        // Admin can filter by vendorId or customerId via query
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
    const total = (await prisma?.order.count({ where })) ?? 0;

    const orders = await prisma?.order.findMany({
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
      orders: orders ?? [],
      total,
      page: pageNum,
      limit: lim,
    });
  } catch (err: any) {
    return handleError(res, err);
  }
};

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
      case "RIDER":
        // Riders may only view orders assigned to them
        where.riderId = actor.id;
        break;
      case "ADMIN":
        // Admin sees everything — no extra filter
        break;
      default:
        throw new AppError(403, "Invalid role");
    }

    // Fetch with relations
    const order = await prisma?.order.findFirst({
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

    // Optional: redact sensitive payment fields for non-admins
    if (actor.role !== "ADMIN" && order.payment) {
      delete (order.payment as any).transactionId;
      // keep status/amount but remove raw provider payloads if any
    }

    return sendSuccess(res, { order });
  } catch (error: any) {
    return handleError(res, error);
  }
};

// Main controller function
export const createOrder = async (req: Request, res: Response) => {
  try {
    const { vendorId, items, deliveryAddress, paymentMethod } =
      validateCreateOrderBody(req.body || {});
    const customerId = getCustomerIdFromRequest(req);

    // Use Prisma? transaction for ACID compliance
    const result = await prisma?.$transaction(async (tx) => {
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

      // 3. Calculate total amount and validate products/variants
      const totalAmount = await calculateOrderTotal(items); // ADDED: Pass transaction

      // 4. Create the order
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
                // Get the price for each item
                let price: number;
                if (item.variantId) {
                  const variant = await tx.productVariant.findUnique({
                    where: { id: item.variantId },
                  });
                  if (!variant) {
                    throw new AppError(
                      404,
                      `Product variant with id ${item.variantId} not found`
                    );
                  }
                  price = variant.price;
                } else {
                  const product = await tx.product.findUnique({
                    where: { id: item.productId },
                  });
                  if (!product) {
                    throw new AppError(
                      404,
                      `Product with id ${item.productId} not found`
                    );
                  }
                  price = product.basePrice;
                }

                return {
                  productId: item.productId,
                  variantId: item.variantId || null,
                  quantity: item.quantity,
                  price: price,
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
            method: paymentMethod,
            status: "PENDING",
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

      return { order, payment };
    });

    // FIXED: Use sendSuccess utility and return success response
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
    handleError(res, error); // FIXED: Use utility function
  }
};

// FIXED: Update payment status (called by Paystack webhook)
export const updatePaymentStatus = async (req: Request, res: Response) => {
  const { paymentId, transactionId, status } = req.body;

  try {
    // ADDED: Validate required fields
    if (!paymentId || !status) {
      throw new AppError(400, "PaymentId and status are required");
    }

    const result = await prisma?.$transaction(async (tx) => {
      // ADDED: Get the payment first to get the orderId
      const payment = await tx.payment.findUnique({
        where: { id: paymentId },
        include: { order: true },
      });

      if (!payment) {
        throw new AppError(404, "Payment not found");
      }

      // Update payment
      const updatedPayment = await tx.payment.update({
        where: { id: paymentId },
        data: {
          transactionId,
          status,
          paidAt: status === "SUCCESSFUL" ? new Date() : null,
        },
      });

      // FIXED: Use payment.orderId instead of paymentId
      if (status === "SUCCESSFUL") {
        await tx.order.update({
          where: { id: payment.orderId }, // FIXED: This was wrong in original
          data: { paymentStatus: "SUCCESSFUL" },
        });

        // ADDED: Create order history entry
        await tx.orderHistory.create({
          data: {
            orderId: payment.orderId,
            status: payment.order.status, // Keep current order status
            actorType: "SYSTEM",
            note: `Payment successful - Transaction ID: ${transactionId}`,
          },
        });
      } else if (status === "FAILED") {
        // ADDED: Handle failed payments
        await tx.order.update({
          where: { id: payment.orderId },
          data: { paymentStatus: "FAILED" },
        });

        await tx.orderHistory.create({
          data: {
            orderId: payment.orderId,
            status: payment.order.status,
            actorType: "SYSTEM",
            note: "Payment failed",
          },
        });
      }

      return updatedPayment;
    });

    return sendSuccess(res, { payment: result });
  } catch (error: any) {
    handleError(res, error); // FIXED: Corrected parameter order
  }
};

export const updateOrderStatus = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status, note } = req.body;
  const actor = getActorFromReq(req);

  // Allowed transitions map (source -> allowed targets)
  const allowedTransitions: Record<string, string[]> = {
    PENDING: ["ACCEPTED", "CANCELLED"],
    ACCEPTED: ["PREPARING", "CANCELLED"],
    PREPARING: ["OUT_FOR_DELIVERY", "CANCELLED"],
    OUT_FOR_DELIVERY: ["DELIVERED", "CANCELLED"],
    DELIVERED: [],
    CANCELLED: [],
  };

  // Role permissions for who can set which status
  const rolePermissions: Record<string, string[]> = {
    VENDOR: ["ACCEPTED", "PREPARING", "CANCELLED"],
    RIDER: ["OUT_FOR_DELIVERY", "DELIVERED"],
    ADMIN: [
      "ACCEPTED",
      "PREPARING",
      "OUT_FOR_DELIVERY",
      "DELIVERED",
      "CANCELLED",
    ],
    CUSTOMER: ["CANCELLED"], // customer can request cancel (you may require rules)
  };

  try {
    if (!id) throw new AppError(400, "Order id required");
    if (!status) throw new AppError(400, "Status required");

    // 1. Load order (no findUnique with two keys)
    const order = await prisma?.order.findUnique({
      where: { id },
      include: { history: true },
    });
    if (!order) throw new AppError(404, "Order not found");

    // 2. Validate transition
    const current = order.status;
    if (
      !allowedTransitions[current] ||
      !allowedTransitions[current].includes(status)
    ) {
      throw new AppError(400, `Invalid transition: ${current} -> ${status}`);
    }

    // 3. Check actor role permission
    const allowedByRole = rolePermissions[actor.role] || [];
    if (!allowedByRole.includes(status)) {
      throw new AppError(
        403,
        `Role ${actor.role} cannot set status to ${status}`
      );
    }

    // 4. If status requires rider assigned (OUT_FOR_DELIVERY) ensure riderId exists
    if (status === "OUT_FOR_DELIVERY" && !order.riderId) {
      throw new AppError(
        400,
        "Order has not been assigned to a rider. Use claim endpoint."
      );
    }

    // 5. Perform update + create history in a transaction
    const updated = await prisma?.$transaction(async (tx) => {
      const o = await tx.order.update({
        where: { id },
        data: { status },
        include: { items: true, payment: true },
      });

      await tx.orderHistory.create({
        data: {
          orderId: id,
          status,
          actorId: actor.id,
          actorType: actor.role,
          note: note ?? `Status changed to ${status}`,
        },
      });

      return o;
    });

    return sendSuccess(res, { order: updated });
  } catch (err) {
    return handleError(res, err);
  }
};

export const claimOrder = async (req: Request, res: Response) => {
  const { id } = req.params;
  const actor = getActorFromReq(req);

  try {
    if (!id) throw new AppError(400, "Order id is required");
    if (!actor?.id) throw new AppError(401, "Unauthorized");
    if (actor.role !== "RIDER")
      throw new AppError(403, "Only riders can claim orders");

    // states that a rider is allowed to claim from
    const claimableStatuses = ["ACCEPTED", "PREPARING"];

    const result = await prisma?.$transaction(async (tx) => {
      // atomic guarded update: only update when riderId is null AND order in claimable status
      const updateRes = await tx.order.updateMany({
        where: {
          id,
          riderId: null,
          status: { in: claimableStatuses as any[] },
        },
        data: {
          riderId: actor.id,
          status: "OUT_FOR_DELIVERY",
        },
      });

      // if no rows updated, someone else claimed it or it's not claimable
      if (updateRes.count === 0) {
        return { success: false };
      }

      // create order history entry for claim
      await tx.orderHistory.create({
        data: {
          orderId: id,
          status: "OUT_FOR_DELIVERY",
          actorId: actor.id,
          actorType: "RIDER",
          note: "Rider claimed the order",
        },
      });

      // fetch the fresh order to return
      const order = await tx.order.findUnique({
        where: { id },
        include: {
          items: { include: { product: true, variant: true } },
          history: { orderBy: { createdAt: "desc" } },
          vendor: { select: { id: true, businessName: true } },
          customer: { select: { id: true, fullName: true } },
        },
      });

      return { success: true, order };
    });

    if (!result?.success) {
      throw new AppError(409, "Order already claimed or not claimable");
    }

    return sendSuccess(res, { order: result?.order });
  } catch (err) {
    return handleError(res, err);
  }
};

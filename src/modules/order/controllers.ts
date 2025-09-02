import { AppError, handleError, sendSuccess } from "@lib/utils/AppError";
import {
  calculateOrderTotal,
  getCustomerIdFromRequest,
  validateCreateOrderBody,
} from "@modules/order/utils";
import { Request, Response } from "express";

export const getOrders = async (req: Request, res: Response) => {
  try {
    // FIXED: Added req parameter and proper user filtering
    const customerId = getCustomerIdFromRequest(req);

    const orders = await prisma?.order.findMany({
      where: { customerId }, // Filter by customer
      take: 20,
      include: {
        items: {
          include: {
            product: true,
            variant: true,
          },
        },
        vendor: {
          select: {
            id: true,
            businessName: true,
          },
        },
        payment: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return sendSuccess(res, { orders }); // FIXED: Changed 'order' to 'orders'
  } catch (error: any) {
    handleError(res, error); // FIXED: Corrected parameter order
  }
};

export const getOrderById = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    // ADDED: Get customer ID for security
    const customerId = getCustomerIdFromRequest(req);

    const order = await prisma?.order.findUnique({
      where: {
        id,
        customerId, // ADDED: Ensure customer can only access their orders
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
        payment: true,
        delivery: true,
        history: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!order) {
      throw new AppError(404, "Order not found");
    }

    return sendSuccess(res, { order });
  } catch (error: any) {
    handleError(res, error); // FIXED: Corrected parameter order
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

// ADDED: New function to handle order status updates
export const updateOrderStatus = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status, actorType = "ADMIN", note } = req.body;

  try {
    // ADDED: Get actor ID from request (could be admin, vendor, or rider)
    const actorId = getCustomerIdFromRequest(req); // Adjust this based on your auth system

    const result = await prisma?.$transaction(async (tx) => {
      const order = await tx.order.update({
        where: { id },
        data: { status },
        include: {
          items: { include: { product: true, variant: true } },
          customer: { select: { id: true, fullName: true, email: true } },
          vendor: { select: { id: true, businessName: true } },
          payment: true,
        },
      });

      // Create history entry
      await tx.orderHistory.create({
        data: {
          orderId: id,
          status,
          actorId,
          actorType,
          note: note || `Order status updated to ${status}`,
        },
      });

      return order;
    });

    return sendSuccess(res, { order: result });
  } catch (error: any) {
    handleError(res, error);
  }
};

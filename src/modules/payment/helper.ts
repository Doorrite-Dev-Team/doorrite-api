import prisma from '@config/db';

// Helper functions for webhook handling
export async function handleSuccessfulCharge(data: any) {
  const reference = data.reference;

  await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findFirst({
      where: { transactionId: reference },
      include: { order: true },
    });

    if (!payment) return;

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: "SUCCESSFUL",
        paidAt: new Date(),
      },
    });

    await tx.order.update({
      where: { id: payment.orderId },
      data: {
        paymentStatus: "SUCCESSFUL",
        status: "ACCEPTED",
      },
    });

    await tx.orderHistory.create({
      data: {
        orderId: payment.orderId,
        status: "ACCEPTED",
        actorId: payment.userId,
        actorType: "SYSTEM",
        note: "Payment completed successfully",
      },
    });
  });
}

export async function handleSuccessfulTransfer(data: any) {
  // Handle successful transfer (e.g., successful refund)
  const reference = data.reference;
  // No refund model in schema; log the transfer for manual reconciliation
  console.log("handleSuccessfulTransfer", reference, data);
}

export async function handleFailedTransfer(data: any) {
  // Handle failed transfer (e.g., failed refund)
  const reference = data.reference;
  // No refund model in schema; log the failed transfer for manual reconciliation
  console.log("handleFailedTransfer", reference, data);
}

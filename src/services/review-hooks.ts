import prisma from "@config/db";

export async function updateVendorRating(vendorId: string) {
  const agg = await prisma.review.aggregate({
    where: { vendorId },
    _avg: { rating: true },
    _count: { rating: true },
  });

  await prisma.vendor.update({
    where: { id: vendorId },
    data: {
      rating: agg._avg.rating || 0,
      reviewCount: agg._count.rating || 0,
    },
  });
}

export async function updateProductRating(productId: string) {
  const agg = await prisma.productReview.aggregate({
    where: { productId },
    _avg: { rating: true },
    _count: { rating: true },
  });

  await prisma.product.update({
    where: { id: productId },
    data: {
      rating: agg._avg.rating || 0,
      reviewCount: agg._count.rating || 0,
    },
  });
}

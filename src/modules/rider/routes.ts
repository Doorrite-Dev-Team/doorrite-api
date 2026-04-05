import { Router } from "express";
import { requireAuth } from "@middleware/auth";
import * as riderController from "./controller";
import * as earningsController from "./earnings.controller";

const router = Router();

// Specific routes FIRST - /me must come before /:id
router.get("/me", requireAuth("rider"), riderController.getCurrentRiderProfile);

router.put("/me", requireAuth("rider"), riderController.updateRiderProfile);

router.get("/orders", requireAuth("rider"), riderController.getRiderOrders);

router.post(
  "/orders/:orderId/claim",
  requireAuth("rider"),
  riderController.claimOrder,
);

router.get(
  "/orders/:orderId",
  requireAuth("rider"),
  riderController.getRiderOrderById,
);

router.get(
  "/orders/:orderId/confirm",
  requireAuth("rider"),
  riderController.generateVendorOrderCode,
);

router.post(
  "/orders/:orderId/decline",
  requireAuth("rider"),
  riderController.declineOrder,
);

router.post(
  "/orders/:orderId/verify-delivery",
  requireAuth("rider"),
  riderController.verifyCustomerDelivery,
);

router.patch(
  "/availability",
  requireAuth("rider"),
  riderController.toggleAvailability,
);

router.get(
  "/history",
  requireAuth("rider"),
  riderController.getDeliveryHistory,
);

router.get("/", requireAuth("admin"), riderController.getAllRiders);

router.get(
  "/earnings/summary",
  requireAuth("rider"),
  earningsController.getEarningsSummary,
);

router.get(
  "/earnings/transactions",
  requireAuth("rider"),
  earningsController.getTransactions,
);

router.get(
  "/earnings/history",
  requireAuth("rider"),
  earningsController.getEarningsHistory,
);

router.get(
  "/earnings/metrics",
  requireAuth("rider"),
  earningsController.getMetrics,
);

router.post(
  "/earnings/withdraw",
  requireAuth("rider"),
  earningsController.requestWithdrawal,
);

router.get(
  "/earnings/withdrawals",
  requireAuth("rider"),
  earningsController.getWithdrawalHistory,
);

router.get(
  "/payout-info",
  requireAuth("rider"),
  earningsController.getPayoutInfo,
);

// Catch-all - MUST be last
router.get("/:id", riderController.getRiderById);

export default router;

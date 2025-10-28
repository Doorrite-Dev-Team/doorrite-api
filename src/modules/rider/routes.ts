import { Router } from "express";
import { requireAuth } from "@middleware/auth";
import * as riderController from "./controller";

const router = Router();

router.get("/:id", riderController.getRiderById);

router.get("/me", requireAuth("rider"), riderController.getCurrentRiderProfile);

router.put("/me", requireAuth("rider"), riderController.updateRiderProfile);

router.get("/orders", requireAuth("rider"), riderController.getRiderOrders);

router.post(
  "/orders/:orderId/claim",
  requireAuth("rider"),
  riderController.claimOrder
);

router.get(
  "/orders/:orderId",
  requireAuth("rider"),
  riderController.getRiderOrderById
);

router.get(
  "/orders/:orderId/confirm",
  requireAuth("rider"),
  riderController.generateVendorOrderCode
);

router.post(
  "/orders/:orderId/decline",
  requireAuth("rider"),
  riderController.declineOrder
);

// router.post("/location", requireAuth("rider"), riderController.updateLocation);

router.patch(
  "/availability",
  requireAuth("rider"),
  riderController.toggleAvailability
);

router.get(
  "/history",
  requireAuth("rider"),
  riderController.getDeliveryHistory
);

router.get("/", requireAuth("admin"), riderController.getAllRiders);

export default router;

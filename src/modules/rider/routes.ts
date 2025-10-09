import { Router } from "express";
import { requireAuth } from "@middleware/auth";
import * as riderController from "./controller";

const router = Router();

// Profile Management
router.get("/:id", riderController.getRiderById);
router.get("/me", requireAuth("rider"), riderController.getCurrentRiderProfile);
router.put("/me", requireAuth("rider"), riderController.updateRiderProfile);

// Orders Management
router.get("/orders", requireAuth("rider"), riderController.getRiderOrders);
router.get(
  "/orders/:id",
  requireAuth("rider"),
  riderController.getRiderOrderById
);
router.post("/claim/:id", requireAuth("rider"), riderController.claimOrder);
router.post("/decline/:id", requireAuth("rider"), riderController.declineOrder);

// Location & Availability
router.post("/location", requireAuth("rider"), riderController.updateLocation);
router.patch(
  "/availability",
  requireAuth("rider"),
  riderController.toggleAvailability
);

// History
router.get(
  "/history",
  requireAuth("rider"),
  riderController.getDeliveryHistory
);

// Admin Routes
router.get("/", requireAuth("admin"), riderController.getAllRiders);

export default router;

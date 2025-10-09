import { Router } from "express";
import { requireAuth, requireAdmin } from "@middleware/auth";
import * as ctrl from "./controllers";

const router = Router();

// Public admin login
router.post("/login", ctrl.adminLogin);

// Protected admin routes (require auth + admin role)
router.use(requireAuth("admin"), requireAdmin);

// Vendor management
router.get("/vendors", ctrl.listVendors);
router.get("/vendors/:vendorId", ctrl.getVendor);
router.patch("/vendors/:vendorId/approve", ctrl.approveVendor);

// Rider management
router.get("/riders", ctrl.listRiders);
router.get("/riders/:riderId", ctrl.getRider);
router.patch("/riders/:riderId/approve", ctrl.approveRider);
router.patch("/riders/:riderId/suspend", ctrl.suspendRider);

// Order management
router.patch("/orders/:orderId/status", ctrl.updateOrderStatus);

// Reports
router.get("/reports", ctrl.getReports);

export default router;

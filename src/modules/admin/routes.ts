import { Router } from "express";
import { requireAuth, requireAdmin } from "@middleware/auth";
import * as ctrl from "./controllers";

const router = Router();

router.post("/login", ctrl.adminLogin);

router.use(requireAuth("admin"), requireAdmin);

//Admin Only Strict route

router.get("/vendors", ctrl.listVendors);

router.get("/vendors/:vendorId", ctrl.getVendor);

router.patch("/vendors/:vendorId/approve", ctrl.approveVendor);

router.get("/riders", ctrl.listRiders);

router.get("/riders/:riderId", ctrl.getRider);

router.patch("/riders/:riderId/approve", ctrl.approveRider);

router.patch("/riders/:riderId/suspend", ctrl.suspendRider);

router.patch("/orders/:orderId/status", ctrl.updateOrderStatus);

router.get("/reports", ctrl.getReports);

export default router;
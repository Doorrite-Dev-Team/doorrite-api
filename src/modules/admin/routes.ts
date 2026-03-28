import { Router } from "express";
import { requireAuth, requireAdmin } from "@middleware/auth";
import * as ctrl from "./controllers";
import * as payoutCtrl from "./payout.controller";

const router = Router();

router.post("/login", ctrl.adminLogin);

router.use(requireAuth("admin"), requireAdmin);

//Admin Only Strict route

//Vendors
router.get("/vendors", ctrl.listVendors);

router.get("/vendors/:vendorId", ctrl.getVendor);

router.patch("/vendors/:vendorId/approve", ctrl.approveVendor);

router.delete("/vendor/:vendorId", ctrl.deleteVendor);

//Riders
router.get("/riders", ctrl.listRiders);

router.get("/riders/:riderId", ctrl.getRider);

router.patch("/riders/:riderId/approve", ctrl.approveRider);

router.patch("/riders/:riderId/suspend", ctrl.suspendRider);

router.delete("/rider/:riderId", ctrl.deleteRider);

//Rider Earnings
router.get("/riders/:riderId/earnings", payoutCtrl.getRiderEarnings);

router.patch("/riders/:riderId/adjust", payoutCtrl.adjustRiderBalance);

//Users
router.get("/users", ctrl.getAllUsers);

router.delete("/users/:userId", ctrl.deleteUser);

//Orders
router.patch("/orders/:orderId/status", ctrl.updateOrderStatus);

router.get("/reports", ctrl.getReports);

// Payouts
router.get("/payouts", payoutCtrl.getAllPayouts);

router.get("/payouts/:id", payoutCtrl.getPayoutById);

router.patch("/payouts/:id/approve", payoutCtrl.approvePayout);

router.patch("/payouts/:id/reject", payoutCtrl.rejectPayout);

router.patch("/payouts/:id/complete", payoutCtrl.completePayout);

export default router;

import { Router } from "express";
import { requireAuth, requireAdmin } from "@middleware/auth";
import * as ctrl from "./controllers";

const router = Router();

router.post("/login", ctrl.adminLogin);
/* #swagger.tags = ['Admin']
 #swagger.summary = 'Admin login'
 #swagger.description = 'Authenticate as an administrator'
*/

router.use(requireAuth("admin"), requireAdmin);


router.get("/vendors", ctrl.listVendors);
/* #swagger.tags = ['Admin']
 #swagger.summary = 'List all vendors'
 #swagger.description = 'Retrieve a list of all vendors'
*/

router.get("/vendors/:vendorId", ctrl.getVendor);
/* #swagger.tags = ['Admin']
 #swagger.summary = 'Get a specific vendor'
 #swagger.description = 'Retrieve details for a single vendor'
*/

router.patch("/vendors/:vendorId/approve", ctrl.approveVendor);
/* #swagger.tags = ['Admin']
 #swagger.summary = 'Approve a vendor'
 #swagger.description = 'Mark a vendor as approved'
*/

router.get("/riders", ctrl.listRiders);
/* #swagger.tags = ['Admin']
 #swagger.summary = 'List all riders'
 #swagger.description = 'Retrieve a list of all riders'
*/

router.get("/riders/:riderId", ctrl.getRider);
/* #swagger.tags = ['Admin']
 #swagger.summary = 'Get a specific rider'
 #swagger.description = 'Retrieve details for a single rider'
*/

router.patch("/riders/:riderId/approve", ctrl.approveRider);
/* #swagger.tags = ['Admin']
 #swagger.summary = 'Approve a rider'
 #swagger.description = 'Mark a rider as approved'
*/

router.patch("/riders/:riderId/suspend", ctrl.suspendRider);
/* #swagger.tags = ['Admin']
 #swagger.summary = 'Suspend a rider'
 #swagger.description = 'Suspend a rider account'
*/

router.patch("/orders/:orderId/status", ctrl.updateOrderStatus);
/* #swagger.tags = ['Admin']
 #swagger.summary = 'Update order status'
 #swagger.description = 'Update the status of an order'
*/

router.get("/reports", ctrl.getReports);
/* #swagger.tags = ['Admin']
 #swagger.summary = 'Get reports'
 #swagger.description = 'Retrieve sales and activity reports'
*/

export default router;

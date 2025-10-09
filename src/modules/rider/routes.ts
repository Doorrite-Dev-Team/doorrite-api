import { Router } from "express";
import { requireAuth } from "@middleware/auth";
import * as riderController from "./controller";

const router = Router();

router.get("/:id", riderController.getRiderById);
/* #swagger.tags = ['Rider']
 #swagger.summary = 'Get rider by ID'
 #swagger.description = 'Retrieve a single rider by their ID'
*/

router.get("/me", requireAuth("rider"), riderController.getCurrentRiderProfile);
/* #swagger.tags = ['Rider']
 #swagger.summary = 'Get current rider profile'
 #swagger.description = 'Retrieve the profile of the currently authenticated rider'
*/

router.put("/me", requireAuth("rider"), riderController.updateRiderProfile);
/* #swagger.tags = ['Rider']
 #swagger.summary = 'Update rider profile'
 #swagger.description = 'Update the profile of the currently authenticated rider'
*/

router.get("/orders", requireAuth("rider"), riderController.getRiderOrders);
/* #swagger.tags = ['Rider']
 #swagger.summary = 'Get rider orders'
 #swagger.description = 'Retrieve a list of orders for the authenticated rider'
*/

router.get("/orders/:id", requireAuth("rider"), riderController.getRiderOrderById);
/* #swagger.tags = ['Rider']
 #swagger.summary = 'Get rider order by ID'
 #swagger.description = 'Retrieve a single order by its ID for the authenticated rider'
*/

router.post("/claim/:id", requireAuth("rider"), riderController.claimOrder);
/* #swagger.tags = ['Rider']
 #swagger.summary = 'Claim an order'
 #swagger.description = 'Claim an order for delivery'
*/

router.post("/decline/:id", requireAuth("rider"), riderController.declineOrder);
/* #swagger.tags = ['Rider']
 #swagger.summary = 'Decline an order'
 #swagger.description = 'Decline an order for delivery'
*/

router.post("/location", requireAuth("rider"), riderController.updateLocation);
/* #swagger.tags = ['Rider']
 #swagger.summary = 'Update rider location'
 #swagger.description = 'Update the current location of the rider'
*/

router.patch("/availability", requireAuth("rider"), riderController.toggleAvailability);
/* #swagger.tags = ['Rider']
 #swagger.summary = 'Toggle rider availability'
 #swagger.description = 'Toggle the availability of the rider to receive new orders'
*/

router.get("/history", requireAuth("rider"), riderController.getDeliveryHistory);
/* #swagger.tags = ['Rider']
 #swagger.summary = 'Get delivery history'
 #swagger.description = 'Retrieve the delivery history for the authenticated rider'
*/

router.get("/", requireAuth("admin"), riderController.getAllRiders);
/* #swagger.tags = ['Rider']
 #swagger.summary = 'Get all riders'
 #swagger.description = 'Retrieve a list of all riders (admin only)'
*/

export default router;

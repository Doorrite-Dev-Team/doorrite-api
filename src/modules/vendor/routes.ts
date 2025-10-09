import { Router } from "express";
import { requireAuth } from "@middleware/auth";
import * as vendorController from "./controllers";

const router = Router();

// Profile Management
router.get("/:id", vendorController.getVendorById);
/* #swagger.tags = ['Vendor']
 #swagger.summary = 'Get vendor by ID'
 #swagger.description = 'Retrieve a single vendor by their ID'
*/

router.get(
  "/me",
  requireAuth("vendor"),
  vendorController.getCurrentVendorProfile
);
/* #swagger.tags = ['Vendor']
 #swagger.summary = 'Get current vendor profile'
 #swagger.description = 'Retrive the current vendor's Profile'
*/

router.put("/me", requireAuth("vendor"), vendorController.updateVendorProfile);
/* #swagger.tags = ['Vendor']
 #swagger.summary = 'Update vendor profile'
 #swagger.description = 'Update the current vendor's Profile'
*/

// Product Management
router.get(
  "/products",
  requireAuth("vendor"),
  vendorController.getVendorProducts
);
/* #swagger.tags = ['Vendor', 'Product']
 #swagger.summary = 'Get vendor products'
 #swagger.description = 'Retrieve a list of all products for the current vendor'
*/

router.post("/products", requireAuth("vendor"), vendorController.createProduct);
/* #swagger.tags = ['Vendor', 'Product']
 #swagger.summary = 'Create a new product'
 #swagger.description = 'Create a new product for the current vendor'
*/

router.put(
  "/products/:id",
  requireAuth("vendor"),
  vendorController.updateProduct
);
/* #swagger.tags = ['Vendor', 'Product']
 #swagger.summary = 'Update a product'
 #swagger.description = 'Update a product for the current vendor'
*/

router.delete(
  "/products/:id",
  requireAuth("vendor"),
  vendorController.deleteProduct
);
/* #swagger.tags = ['Vendor', 'Product']
 #swagger.summary = 'Delete a product'
 #swagger.description = 'Delete a product for the current vendor'
*/

// Product Variants
router.put(
  "/products/:id/variants/:variantId",
  requireAuth("vendor"),
  vendorController.updateProductVariant
);
/* #swagger.tags = ['Vendor', 'Product']
 #swagger.summary = 'Update a product variant'
 #swagger.description = 'Update a product variant for the current vendor'
*/

router.delete(
  "/products/:id/variants/:variantId",
  requireAuth("vendor"),
  vendorController.deleteProductVariant
);
/* #swagger.tags = ['Vendor', 'Product']
 #swagger.summary = 'Delete a product variant'
 #swagger.description = 'Delete a product variant for the current vendor'
*/

// Order Management
router.get("/orders", requireAuth("vendor"), vendorController.getVendorOrders);
/* #swagger.tags = ['Vendor', 'Order']
 #swagger.summary = 'Get vendor orders'
 #swagger.description = 'Retrieve a list of all orders for the current vendor'
*/

router.get(
  "/orders/:orderId",
  requireAuth("vendor"),
  vendorController.getVendorOrderById
);
/* #swagger.tags = ['Vendor', 'Order']
 #swagger.summary = 'Get vendor order by ID'
 #swagger.description = 'Retrieve a single order by its ID for the current vendor'
*/

router.patch(
  "/orders/:orderId/status",
  requireAuth("vendor"),
  vendorController.updateOrderStatus
);
/* #swagger.tags = ['Vendor', 'Order']
 #swagger.summary = 'Update order status'
 #swagger.description = 'Update the status of an order for the current vendor'
*/

// Public Routes
router.get("/", vendorController.getAllVendors);
/* #swagger.tags = ['Vendor']
 #swagger.summary = 'Get all vendors'
 #swagger.description = 'Retrieve a list of all vendors'
*/

export default router;

import { Router } from "express";
import { requireAuth } from "@middleware/auth";
import * as vendorController from "./controllers";

const router = Router();

// Profile Management
router.get("/:id", vendorController.getVendorById);

router.get(
  "/me",
  requireAuth("vendor"),
  vendorController.getCurrentVendorProfile
);

router.put("/me", requireAuth("vendor"), vendorController.updateVendorProfile);

// Product Management
router.get(
  "/products",
  requireAuth("vendor"),
  vendorController.getVendorProducts
);

router.post("/products", requireAuth("vendor"), vendorController.createProduct);

router.put(
  "/products/:id",
  requireAuth("vendor"),
  vendorController.updateProduct
);

router.delete(
  "/products/:id",
  requireAuth("vendor"),
  vendorController.deleteProduct
);

// Product Variants
router.put(
  "/products/:id/variants/:variantId",
  requireAuth("vendor"),
  vendorController.updateProductVariant
);

router.delete(
  "/products/:id/variants/:variantId",
  requireAuth("vendor"),
  vendorController.deleteProductVariant
);

// Order Management
router.get("/orders", requireAuth("vendor"), vendorController.getVendorOrders);

router.get(
  "/orders/:orderId",
  requireAuth("vendor"),
  vendorController.getVendorOrderById
);

router.patch(
  "/orders/:orderId/status",
  requireAuth("vendor"),
  vendorController.updateOrderStatus
);

// Public Routes
router.get("/", vendorController.getAllVendors);

export default router;

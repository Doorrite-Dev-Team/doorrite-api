import { Router } from "express";
import { requireAuth } from "@middleware/auth";
import * as vendorController from "./controllers";

const router = Router();

// --- 1. DASHBOARD & STATS (Static Paths First) ---
router.get(
  "/dashboard",
  requireAuth("vendor"),
  vendorController.getVendorDashboard,
);

router.get("/stats", requireAuth("vendor"), vendorController.getVendorStats);

router.get(
  "/earnings",
  requireAuth("vendor"),
  vendorController.getVendorEarnings,
);

// --- 2. ORDER MANAGEMENT (Moved above /:id to prevent shadowing) ---
router.get("/orders", requireAuth("vendor"), vendorController.getVendorOrders);

router.get(
  "/orders/:orderId",
  requireAuth("vendor"),
  vendorController.getVendorOrderById,
);

router.post(
  "/orders/:orderId/confirm-rider",
  requireAuth("vendor"),
  vendorController.confirmOrderRider,
);

router.patch(
  "/orders/:orderId/status",
  requireAuth("vendor"),
  vendorController.updateOrderStatus,
);

// --- 3. PRODUCT MANAGEMENT (Static paths and specific vendor context) ---
router.get("/products", requireAuth("vendor"), vendorController.getProducts);

router.post("/products", requireAuth("vendor"), vendorController.createProduct);

router.put(
  "/products/:id",
  requireAuth("vendor"),
  vendorController.updateProduct,
);

router.delete(
  "/products/:id",
  requireAuth("vendor"),
  vendorController.deleteProduct,
);

// Product Variants
router.post(
  "/products/:id/variants",
  requireAuth("vendor"),
  vendorController.createProductVariant,
);

router.put(
  "/products/:id/variants/:variantId",
  requireAuth("vendor"),
  vendorController.updateProductVariant,
);

router.delete(
  "/products/:id/variants/:variantId",
  requireAuth("vendor"),
  vendorController.deleteProductVariant,
);

// --- 4. VENDOR PROFILE & SETTINGS (Self) ---
router.get(
  "/profile",
  requireAuth("vendor"),
  vendorController.getCurrentVendorProfile,
);

router.put(
  "/profile",
  requireAuth("vendor"),
  vendorController.updateVendorProfile,
);

router.get(
  "/notifications/settings",
  requireAuth("vendor"),
  vendorController.getNotificationSettings,
);

router.put(
  "/notifications/settings",
  requireAuth("vendor"),
  vendorController.updateNotificationSettings,
);

router.put(
  "/profile/password",
  requireAuth("vendor"),
  vendorController.changeVendorPassword,
);

router.put(
  "/settings",
  requireAuth("vendor"),
  vendorController.updateVendorProfileSettings,
);

router.put(
  "/password",
  requireAuth("vendor"),
  vendorController.changeVendorPassword,
);

router.put(
  "/notification-settings",
  requireAuth("vendor"),
  vendorController.updateNotificationSettings,
);

// --- 5. PUBLIC & DYNAMIC ID ROUTES (Last to prevent shadowing) ---
router.get("/", vendorController.getAllVendors);

// Public profile and specific vendor lookups
router.get("/profile/:id", vendorController.getVendorProfile);
router.get("/:id", vendorController.getVendorById);
router.get("/:id/products", vendorController.getVendorProducts);
router.get("/:id/reviews", vendorController.getVendorReviews);

export default router;

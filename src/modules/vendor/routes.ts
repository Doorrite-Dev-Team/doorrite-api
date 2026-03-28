import { Router } from "express";
import { requireAuth } from "@middleware/auth";
import * as vendorController from "./controllers";
import * as productsController from "./products.controllers";
import * as modifiersController from "./modifiers.controllers";

const router = Router();

// ============================================================================
// EXISTING ROUTES
// ============================================================================

// Profile
router.get("/:id", vendorController.getVendorById);
router.get(
  "/me",
  requireAuth("vendor"),
  vendorController.getCurrentVendorProfile,
);
router.put("/me", requireAuth("vendor"), vendorController.updateVendorProfile);

// Products
router.get(
  "/:id/products",
  requireAuth("any"),
  productsController.getVendorProducts,
);
router.post(
  "/products",
  requireAuth("vendor"),
  productsController.createProduct,
);
router.put(
  "/products/:id",
  requireAuth("vendor"),
  productsController.updateProduct,
);
router.delete(
  "/products/:id",
  requireAuth("vendor"),
  productsController.deleteProduct,
);

// Variants
router.put(
  "/products/:id/variants/:variantId",
  requireAuth("vendor"),
  productsController.updateProductVariant,
);
router.delete(
  "/products/:id/variants/:variantId",
  requireAuth("vendor"),
  productsController.deleteProductVariant,
);

// Orders
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

// Public
router.get("/", vendorController.getAllVendorsV2);
router.get("/:id/reviews", vendorController.getVendorReviews);

// ============================================================================
// ✅ NEW MODIFIER ROUTES (MVP)
// ============================================================================

// Modifier Group CRUD
router.get(
  "/modifiers",
  requireAuth("vendor"),
  modifiersController.getModifierGroups,
);
router.post(
  "/modifiers",
  requireAuth("vendor"),
  modifiersController.createModifierGroup,
);
router.get(
  "/modifiers/:id",
  requireAuth("vendor"),
  modifiersController.getModifierGroupById,
);
router.put(
  "/modifiers/:id",
  requireAuth("vendor"),
  modifiersController.updateModifierGroup,
);
router.delete(
  "/modifiers/:id",
  requireAuth("vendor"),
  modifiersController.deleteModifierGroup,
);

// Modifier Option CRUD
router.post(
  "/modifiers/:id/options",
  requireAuth("vendor"),
  modifiersController.createModifierOption,
);
router.put(
  "/modifiers/:groupId/options/:optionId",
  requireAuth("vendor"),
  modifiersController.updateModifierOption,
);
router.delete(
  "/modifiers/:groupId/options/:optionId",
  requireAuth("vendor"),
  modifiersController.deleteModifierOption,
);

// Product-Modifier Assignment
router.get(
  "/products/:id/modifiers",
  requireAuth("vendor"),
  modifiersController.getProductModifiers,
);
router.post(
  "/products/:id/modifiers",
  requireAuth("vendor"),
  modifiersController.assignModifierToProduct,
);
router.delete(
  "/products/:productId/modifiers/:modifierGroupId",
  requireAuth("vendor"),
  modifiersController.removeModifierFromProduct,
);

export default router;

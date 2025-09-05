import { requireAuth } from "@middleware/auth";
import { Router } from "express";
import * as vendorController from "./controllers";

// Vendor Product Management Routes (Protected)
const router = Router();

router.use(requireAuth("vendor"));

// =========================
// VENDOR ROUTES (Auth Required)
// =========================
// Create product
// POST /api/v1/products
router.post("/", vendorController.createProduct);

// Update product (vendor must own product)
// PUT /api/v1/products/:id
router.put("/:id", vendorController.updateProduct);

// Soft delete (prepare-delete)
// POST /api/v1/products/:id/prepare-delete
router.post("/:id/prepare-delete", vendorController.prepareProductDeletion);

// Permanent delete
// DELETE /api/v1/products/:id
router.delete("/:id", vendorController.deleteProduct);

// =========================
// VARIANT MANAGEMENT (Vendor only)
// =========================
// Create variant
// POST /api/v1/products/:id/variants
router.post("/:id/variants", vendorController.createProductVariant);

// Update variant
// PUT /api/v1/products/:id/variants/:variantId
router.put("/:id/variants/:variantId", vendorController.updateProductVariant);

// Delete variant
// DELETE /api/v1/products/:id/variants/:variantId
router.delete(
  "/:id/variants/:variantId",
  vendorController.deleteProductVariant
);

export default router;

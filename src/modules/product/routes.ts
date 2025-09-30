// routes/products.ts
import express from "express";
import * as ProductController from "./controllers"; // adjust path as needed
import { requireAuth } from "@middleware/auth";

const router = express.Router();

// =========================
// PUBLIC ROUTES (No Auth)
// =========================
// GET /api/v1/products
router.get("/", ProductController.getProducts);

// GET /api/v1/products/:id
router.get("/:id", ProductController.getProductById);

// =========================
// (Vwndor Auth Required)
// =========================

router.use(requireAuth("vendor"));

// Create product
// POST /api/v1/products

router.post("/", ProductController.createProduct);

// Update product (vendor must own product)
// PUT /api/v1/products/:id
router.put("/:id", ProductController.updateProduct);

// Soft delete (prepare-delete)
// POST /api/v1/products/:id/prepare-delete
router.post("/:id/prepare-delete", ProductController.prepareProductDeletion);

// Permanent delete
// DELETE /api/v1/products/:id
router.delete("/:id", ProductController.deleteProduct);

// =========================
// VARIANT MANAGEMENT (Vendor only)
// =========================
// Create variant
// POST /api/v1/products/:id/variants
router.post("/:id/variants", ProductController.createProductVariant);

// Update variant
// PUT /api/v1/products/:id/variants/:variantId
router.put("/:id/variants/:variantId", ProductController.updateProductVariant);

// Delete variant
// DELETE /api/v1/products/:id/variants/:variantId
router.delete(
  "/:id/variants/:variantId",
  ProductController.deleteProductVariant
);

export default router;

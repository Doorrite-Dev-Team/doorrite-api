// routes/products.ts
import express from "express";
import * as ProductController from "./controllers"; // adjust path as needed
import { requireAuth } from "@middleware/auth";

const router = express.Router();

// =========================
// PUBLIC ROUTES (No Auth)
// =========================
router.get("/", ProductController.getProducts);
/* #swagger.tags = ['Product']
 #swagger.summary = 'List all products'
 #swagger.description = 'Retrieve a list of all available products'
*/

router.get("/:id", ProductController.getProductById);
/* #swagger.tags = ['Product']
 #swagger.summary = 'Get a specific product'
 #swagger.description = 'Retrieve details for a single product by its ID'
*/

// // =========================
// // (Vendor Auth Required)
// // =========================

// router.use(requireAuth("vendor"));

// router.post("/", ProductController.createProduct);
// /* #swagger.tags = ['Product']
//  #swagger.summary = 'Create a new product'
//  #swagger.description = 'Create a new product (vendor only)'
// */

// router.put("/:id", ProductController.updateProduct);
// /* #swagger.tags = ['Product']
//  #swagger.summary = 'Update a product'
//  #swagger.description = 'Update an existing product (vendor must own product)'
// */

// router.post("/:id/prepare-delete", ProductController.prepareProductDeletion);
// /* #swagger.tags = ['Product']
//  #swagger.summary = 'Prepare product for deletion'
//  #swagger.description = 'Soft delete a product (prepare for permanent deletion)'
// */

// router.delete("/:id", ProductController.deleteProduct);
// /* #swagger.tags = ['Product']
//  #swagger.summary = 'Delete a product'
//  #swagger.description = 'Permanently delete a product'
// */

// // =========================
// // VARIANT MANAGEMENT (Vendor only)
// // =========================
// router.post("/:id/variants", ProductController.createProductVariant);
// /* #swagger.tags = ['Product']
//  #swagger.summary = 'Create a product variant'
//  #swagger.description = 'Create a new variant for a product'
// */

// router.put("/:id/variants/:variantId", ProductController.updateProductVariant);
// /* #swagger.tags = ['Product']
//  #swagger.summary = 'Update a product variant'
//  #swagger.description = 'Update an existing product variant'
// */

// router.delete("/:id/variants/:variantId", ProductController.deleteProductVariant);
// /* #swagger.tags = ['Product']
//  #swagger.summary = 'Delete a product variant'
//  #swagger.description = 'Delete a product variant'
// */

export default router;

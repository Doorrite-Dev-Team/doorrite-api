// src/routes/auth.ts
import express from "express";
import { requireAuth } from "middleware/auth";
import * as ProductRoutes from "./controllers";
const router = express.Router();

// router.get("/get-vendor", Vendor.getVendor);
// router.get("/vendors/:id", Vendor.getVendorById);
// router.get("/vendors", Vendor.getVendors);
router.get("/getAll", ProductRoutes.getProducts)
router.get("/:id", ProductRoutes.getProductsById)
router.post("/create", requireAuth("vendor"),ProductRoutes.createProduct)
router.put("/update", requireAuth("vendor"),ProductRoutes.updateProduct)


//delete
router.delete(
  "/prepare-delete",
  requireAuth("vendor"),
  ProductRoutes.prepareProductDeletion
);
router.delete(
  "permanent-delete", 
  requireAuth("vendor"),
  ProductRoutes.deleteProduct
)

export default router;

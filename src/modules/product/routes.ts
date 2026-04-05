// routes/products.ts
import express from "express";
import * as ProductController from "./controllers"; // adjust path as needed

const router = express.Router();

// =========================
// PUBLIC ROUTES (No Auth)
// =========================
router.get("/", ProductController.getProducts);

router.get("/vendor/:vendorId", ProductController.getVendorProducts);

router.get("/delivery-calculation", ProductController.getDeliveryCalculation);

router.get("/:id", ProductController.getProductById);

export default router;

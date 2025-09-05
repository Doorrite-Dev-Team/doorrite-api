// routes/products.ts
import express from "express";
import * as ProductController from "./controllers"; // adjust path as needed

const router = express.Router();

// =========================
// PUBLIC ROUTES (No Auth)
// =========================
// GET /api/v1/products
router.get("/", ProductController.getProducts);

// GET /api/v1/products/:id
router.get("/:id", ProductController.getProductById);

export default router;

// src/routes/auth.ts
import express from "express";
import * as Vendor from "./controllers";
const router = express.Router();

router.get("/current", Vendor.getVendor);
router.get("/:id", Vendor.getVendorById);
router.get("/getAll", Vendor.getVendors);

export default router;

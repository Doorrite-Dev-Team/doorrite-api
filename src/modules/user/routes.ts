// src/routes/auth.ts
import express from "express";
import * as User from "./controllers";
const router = express.Router();

router.get("/get-user", User.getUser);


export default router;

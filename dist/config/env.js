"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DATABASE_URL = exports.PORT = void 0;
require("dotenv/config");
exports.PORT = Number(process.env.PORT) || 4000;
exports.DATABASE_URL = process.env.DATABASE_URL;

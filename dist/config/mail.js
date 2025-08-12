"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const nodemailer_1 = __importDefault(require("nodemailer"));
//import type SMTPTransport from 'nodemailer/lib/smtp-transport';
const transporter = nodemailer_1.default.createTransport({
    service: "gmail",
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});
const sendmail = async (to, subject, text, html) => {
    try {
        //send email using the transporter
        const info = await transporter.sendMail({
            from: process.env.SMTP_USER,
            to,
            subject,
            text,
            html,
        });
        console.log("Email sent: " + info.response);
        return info;
    }
    catch (error) {
        console.error("Error sending email:", error);
        throw error;
    }
};
exports.default = sendmail;

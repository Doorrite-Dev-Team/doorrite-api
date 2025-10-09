import "dotenv/config";
import nodemailer from "nodemailer";
//import type SMTPTransport from 'nodemailer/lib/smtp-transport';

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false, // use STARTTLS
  requireTLS: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  connectionTimeout: 30000,
  greetingTimeout: 30000,
  tls: {
    rejectUnauthorized: false, // only for debugging
  },
  logger: true,
  debug: true,
});

const sendmail = async (
  to: string,
  subject: string,
  text: string,
  html?: string
) => {
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
  } catch (error) {
    console.error("Error sending email:", error);
    throw error;
  }
};

export default sendmail;

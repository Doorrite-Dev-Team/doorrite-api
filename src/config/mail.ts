import "dotenv/config";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const sendMail = async (
  to: string,
  subject: string,
  text: string,
  html?: string
) => {
  try {
    const fromEmail = process.env.RESEND_FROM ?? "doorrite.info@gmail.com";

    const response = await resend.emails.send({
      from: fromEmail,
      to,
      subject,
      text,
      html,
    });

    console.log(
      "✅ Email sent successfully:",
      response.data?.id ?? "No ID returned"
    );
    return response.data;
  } catch (error: any) {
    console.error("❌ Email send failed:", error.message || error);
    throw new Error(error.message || "Email send failed");
  }
};

export default sendMail;

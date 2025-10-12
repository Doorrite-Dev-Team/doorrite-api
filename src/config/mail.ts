import axios from 'axios';
import "dotenv/config";
// import { Resend } from "resend";

// const resend = new Resend(process.env.RESEND_API_KEY);

type ProxyResponse = {
  ok: boolean,
  error: string
  messageId: string
}

const sendMail = async (
  to: string,
  subject: string,
  text: string,
  html?: string
) => {
  try {
    // const fromEmail = process.env.RESEND_FROM ?? "onboarding@resend.dev";

    const {data} = await axios.post<ProxyResponse>(`${process.env.PROXY_URL}/api/send-email`, {
      to,
      subject,
      text,
      html,
    });

    if (data.error || !data.ok) {
      throw new Error("Error Sending Email: " + data.error);
    }
    console.log("Raw response:", data);
    return data;
  } catch (error: any) {
    console.error("❌ Email send failed:", error.message || error);
    throw new Error(error.message || "Email send failed");
  }
};

export default sendMail;

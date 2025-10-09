// src/lib/emailTemplates.ts

const brandPrimary = "oklch(0.4421 0.1504 142.4953)";
const brandBackground = "#f9fafb";
const brandForeground = "#111827";
const brandSecondary = "oklch(0.8652 0.1768 90.3816)";

const baseWrapper = `
  font-family: Inter, Arial, sans-serif;
  background-color: ${brandBackground};
  padding: 40px 0;
  text-align: center;
`;

const baseCard = `
  max-width: 600px;
  margin: auto;
  background-color: white;
  border-radius: 12px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.05);
  overflow: hidden;
`;

const headerStyle = `
  background-color: ${brandPrimary};
  color: white;
  padding: 24px 0;
  font-size: 28px;
  font-weight: 600;
  letter-spacing: 0.5px;
`;

const footerStyle = `
  font-size: 12px;
  color: #9ca3af;
  text-align: center;
  margin-top: 24px;
`;

// 🔹 1. VERIFICATION EMAIL
export function verificationEmailOTPTemplate(fullName: string, OTP: string) {
  const OTPExpiryMinutes = process.env.OTP_EXPIRY_MINUTES || "15";

  return {
    subject: "Doorite: Verify Your Email",
    text: `Hi ${fullName},

Welcome to Doorite! Use this code to verify your account: ${OTP}

This code expires in ${OTPExpiryMinutes} minutes.

If you didn’t request this, please ignore this message.`,
    html: `
    <div style="${baseWrapper}">
      <div style="${baseCard}">
        <div style="${headerStyle}">Doorite</div>
        <div style="padding: 32px; text-align: left; color: ${brandForeground};">
          <h2 style="font-weight: 600; margin-bottom: 12px;">Welcome, ${fullName} 👋</h2>
          <p style="font-size: 15px; line-height: 1.6;">
            Use the verification code below to activate your account:
          </p>
          <div style="text-align: center; margin: 28px 0;">
            <div style="
              display: inline-block;
              background-color: ${brandSecondary};
              color: ${brandPrimary};
              font-size: 34px;
              font-weight: 700;
              letter-spacing: 6px;
              padding: 14px 28px;
              border-radius: 8px;
            ">${OTP}</div>
          </div>
          <p style="font-size: 14px; color: #6b7280;">
            This code is valid for <strong>${OTPExpiryMinutes}</strong> minutes.
          </p>
          <hr style="border:none; border-top:1px solid #eee; margin:32px 0;">
          <p style="font-size: 12px; color: #9ca3af;">
            Didn’t request this? You can safely ignore this email.
          </p>
        </div>
      </div>
      <div style="${footerStyle}">
        &copy; ${new Date().getFullYear()} Doorite. All rights reserved.
      </div>
    </div>
  `,
  };
}

// 🔹 2. PRODUCT DELETION EMAIL
export function productDeletionEmailTemplate(
  vendorName: string,
  productName: string
) {
  const deletionDays = 30;
  const appUrl = process.env.APP_URL || "#";

  return {
    subject: "⚠️ Doorite: Product Scheduled for Deletion",
    text: `Hi ${vendorName},

Your product "${productName}" has been marked as unavailable and will be permanently deleted in ${deletionDays} days.

If this was a mistake, log in to your dashboard and reinstate it before then.

${appUrl}

– Doorite Support`,
    html: `
    <div style="${baseWrapper}">
      <div style="${baseCard}">
        <div style="${headerStyle}">Product Deletion Notice ⚠️</div>
        <div style="padding: 32px; color: ${brandForeground}; text-align: left;">
          <p>Hi <strong>${vendorName}</strong>,</p>
          <p style="font-size: 15px; line-height: 1.6;">
            Your product <strong style="color: ${brandSecondary};">${productName}</strong>
            has been marked as unavailable and will be permanently deleted in
            <strong>${deletionDays} days</strong>.
          </p>
          <p>If this was unintentional, you can restore it before the deadline.</p>
          <div style="text-align:center; margin: 32px 0;">
            <a href="${appUrl}" style="
              background-color: ${brandPrimary};
              color: white;
              padding: 12px 24px;
              border-radius: 6px;
              font-weight: 600;
              text-decoration: none;
              display: inline-block;
            ">Open Dashboard</a>
          </div>
          <hr style="border:none; border-top:1px solid #eee; margin:32px 0;">
          <p style="font-size: 12px; color: #9ca3af;">
            This is an automated message. Do not reply directly.
          </p>
        </div>
      </div>
      <div style="${footerStyle}">
        &copy; ${new Date().getFullYear()} Doorite. All rights reserved.
      </div>
    </div>
  `,
  };
}

// 🔹 3. PASSWORD RESET EMAIL
export function passwordResetEmailTemplate(
  fullName: string,
  resetLink: string
) {
  return {
    subject: "Doorite: Password Reset Request",
    text: `Hi ${fullName},

You requested a password reset. Click the link below to reset your password:

${resetLink}

If you didn’t request this, ignore this email.`,
    html: `
    <div style="${baseWrapper}">
      <div style="${baseCard}">
        <div style="${headerStyle}">Password Reset</div>
        <div style="padding: 32px; color: ${brandForeground}; text-align: left;">
          <p>Hi <strong>${fullName}</strong>,</p>
          <p style="font-size: 15px; line-height: 1.6;">
            You requested to reset your password. Click the button below to continue:
          </p>
          <div style="text-align: center; margin: 32px 0;">
            <a href="${resetLink}" style="
              background-color: ${brandSecondary};
              color: ${brandPrimary};
              padding: 14px 28px;
              border-radius: 6px;
              font-weight: 600;
              text-decoration: none;
            ">Reset Password</a>
          </div>
          <p style="font-size: 13px; color: #6b7280;">
            If the button doesn’t work, copy and paste this link into your browser:
          </p>
          <p style="font-size: 13px; color: ${brandPrimary}; word-break: break-all;">
            ${resetLink}
          </p>
          <hr style="border:none; border-top:1px solid #eee; margin:32px 0;">
          <p style="font-size: 12px; color: #9ca3af;">
            If you didn’t request this, no action is needed.
          </p>
        </div>
      </div>
      <div style="${footerStyle}">
        &copy; ${new Date().getFullYear()} Doorite. All rights reserved.
      </div>
    </div>
  `,
  };
}

// src/lib/emailTemplates.ts
export function verificationEmailTemplate(fullName: string, OTP: string) {
  const brandPrimary = "oklch(0.4421 0.1504 142.4953)";
  const brandBackground = "oklch(0.9859 0.0084 145.5113)";
  const brandForeground = "oklch(0.1408 0.0044 285.8229)";
  const brandSecondary = "oklch(0.8652 0.1768 90.3816)";

  const OTPExpiryMinutes = process.env.OTP_EXPIRY_MINUTES || "15";

  return {
    subject: "Doorite: Your Verification Code",
    text: `Hi ${fullName},\n\nWelcome to Doorite! Use this code to verify your account: ${OTP}\n\nThis code is valid for ${OTPExpiryMinutes} minutes.\n\nIf you didn't request this, please ignore this email.`,
    html: `
      <div style="font-family: Arial, sans-serif; background-color: ${brandBackground}; padding: 20px; text-align: center;">
        <div style="max-width: 600px; margin: auto; background-color: white; border-radius: 10px; box-shadow: 0 4px 8px rgba(0,0,0,0.1); overflow: hidden;">
          <div style="background-color: ${brandPrimary}; padding: 20px 0;">
            <h1 style="color: white; margin: 0; font-size: 28px;">Doorite</h1>
          </div>
          <div style="padding: 20px;">
            <p style="font-size: 16px; color: ${brandForeground};">Hi ${fullName},</p>
            <h2 style="font-size: 20px; color: ${brandForeground}; margin-bottom: 20px;">Welcome to Doorite!</h2>
            <p style="font-size: 16px; color: ${brandForeground};">Use the following code to verify your account:</p>
            <div style="background-color: ${brandSecondary}; color: ${brandPrimary}; font-size: 32px; font-weight: bold; letter-spacing: 5px; padding: 15px; border-radius: 5px; display: inline-block; margin: 20px 0;">
              ${OTP}
            </div>
            <p style="font-size: 14px; color: #666;">This code is valid for <strong>${OTPExpiryMinutes}</strong> minutes.</p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 25px 0;">
            <p style="font-size: 12px; color: #999;">If you didn't request this, please ignore this email.</p>
          </div>
        </div>
      </div>
    `,
  };
}

export function passwordResetEmailTemplate(
  fullName: string,
  resetLink: string
) {
  return {
    subject: "Password Reset Request",
    text: `Hi ${fullName},\n\nYou requested a password reset. Click the link below to reset your password:\n${resetLink}\n\nIf you didn't request this, ignore this email.`,
    html: `<p>Hi ${fullName},</p>
           <p>You requested a password reset. Click the link below to reset your password:</p>
           <p><a href="${resetLink}">${resetLink}</a></p>
           <p>If you didn't request this, ignore this email.</p>`,
  };
}

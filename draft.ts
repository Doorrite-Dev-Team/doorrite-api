//disable type check
// @ts-nocheck

router.post("/generate-otp", async (req, res) => {
  try {
    const { identifier, type } = genSchema.parse(req.body);
    const out = await createOtpIfNotExists(type, identifier);
    if (!out.ok) {
      return res
        .status(409)
        .json({
          ok: false,
          message: "OTP already requested",
          ttlSeconds: out.ttlSeconds,
        });
    }

    // TODO: send via SMS/email provider here. For testing we return code.
    return res.json({
      ok: true,
      message: "OTP created",
      code: out.code,
      ttlSeconds: out.ttlSeconds,
    });
  } catch (err: any) {
    if (err?.name === "ZodError")
      return res.status(400).json({ ok: false, error: err.errors });
    console.error(err);
    return res.status(500).json({ ok: false });
  }
});

router.post("/verify-otp", async (req, res) => {
  try {
    const { identifier, type, code } = verifySchema.parse(req.body);
    const result = await verifyOtp(type, identifier, code);
    if (result.ok) return res.json({ ok: true, message: "verified" });

    if (result.reason === "blocked" || result.reason === "blocked_after_failed")
      return res
        .status(429)
        .json({
          ok: false,
          message: "Too many attempts. Wait until OTP expires.",
        });

    if (result.reason === "expired")
      return res.status(410).json({ ok: false, message: "OTP expired" });

    return res
      .status(401)
      .json({
        ok: false,
        message: "Invalid OTP",
        attempts: result.attempts,
        remaining: result.remaining,
      });
  } catch (err: any) {
    if (err?.name === "ZodError")
      return res.status(400).json({ ok: false, error: err.errors });
    console.error(err);
    return res.status(500).json({ ok: false });
  }
});

router.get("/otp-status", async (req, res) => {
  const { identifier, type } = req.query as {
    identifier?: string;
    type?: string;
  };
  if (!identifier || !type)
    return res
      .status(400)
      .json({ ok: false, message: "identifier and type required" });
  const st = await getOtpStatus(type, identifier);
  return res.json({ ok: true, ...st });
});

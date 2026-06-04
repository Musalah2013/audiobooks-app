export async function sendEmail(options: {
  to: string;
  toName?: string;
  subject: string;
  html: string;
  from?: string;
  fromName?: string;
  emailBinding?: SendEmail;
}): Promise<void> {
  const binding = options.emailBinding;
  if (!binding) {
    throw new Error("EMAIL binding is not configured. Add [[send_email]] to wrangler.toml.");
  }
  try {
    await binding.send({
      to: { email: options.to, name: options.toName ?? options.to },
      from: { email: options.from ?? "noreply@audiobooks.samawy-ops.com", name: options.fromName ?? "Samawy Audiobooks Ops" },
      subject: options.subject,
      html: options.html,
    });
  } catch (error) {
    const code = (error as any).code ?? "UNKNOWN";
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Email send failed (${code}): ${message}`);
  }
}

const SAMAWY_LOGO_URL = "https://samawy-ops.com/samawy/assets/logo-on-dark.png";

export function magicLinkEmail(link: string, recipientName?: string, studioLogoUrl?: string): string {
  const name = recipientName ? `<strong style="color:#0a1628;">${recipientName}</strong>` : "<strong style=\"color:#0a1628;\">فريق العمل</strong>";
  const studioLogoHtml = studioLogoUrl
    ? `<tr><td align="center" style="padding:0 0 20px;"><img src="${studioLogoUrl}" alt="شعار الاستوديو" width="64" height="64" style="display:block;border-radius:12px;object-fit:cover;"></td></tr>`
    : "";
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>رابط الدخول إلى بوابة سماوي</title>
</head>
<body style="margin:0;padding:0;background:#f0f2f5;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;-webkit-font-smoothing:antialiased;">

  <!-- Header -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0a1628;">
    <tr>
      <td align="center" style="padding:36px 20px 28px;">
        <img src="${SAMAWY_LOGO_URL}" alt="سماوي" width="150" style="display:block;border:0;outline:none;">
      </td>
    </tr>
  </table>

  <!-- Body -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f0f2f5;">
    <tr>
      <td align="center" style="padding:36px 16px 48px;">
        <table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;width:100%;background:#ffffff;border-radius:20px;box-shadow:0 8px 32px rgba(10,22,40,0.08);">
          <tr>
            <td style="padding:44px 40px 40px;">

              ${studioLogoHtml}

              <!-- Greeting -->
              <p style="margin:0 0 16px;font-size:20px;font-weight:700;color:#0a1628;line-height:1.5;">
                مرحباً ${name} 👋
              </p>

              <!-- Message -->
              <p style="margin:0 0 28px;font-size:15px;color:#4a5568;line-height:1.8;">
                لقد طلبتَ رابط الدخول إلى <strong style="color:#0a1628;">بوابة سماوي للاستوديوهات</strong>. اضغط على الزر أدناه للدخول مباشرة. الرابط صالح لمدة <strong style="color:#0a1628;">24 ساعة</strong> فقط لأسباب أمنية.
              </p>

              <!-- CTA Button -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="padding:8px 0 28px;">
                    <a href="${link}" style="display:inline-block;padding:16px 40px;background:#0b80ff;color:#ffffff;text-decoration:none;border-radius:12px;font-weight:700;font-size:16px;box-shadow:0 4px 16px rgba(11,128,255,0.25);">
                      الدخول إلى البوابة
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Divider -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr><td style="border-top:1px solid #edf2f7;padding-top:24px;"></td></tr>
              </table>

              <!-- Security Note -->
              <p style="margin:0;font-size:13px;color:#8898aa;line-height:1.7;text-align:center;">
                🔒 إذا لم تطلب هذا الرابط، يمكنك تجاهل هذا البريد بأمان. لا أحد يمكنه الدخول بدون الوصول إلى بريدك الإلكتروني.
              </p>

            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>

  <!-- Footer -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f0f2f5;">
    <tr>
      <td align="center" style="padding:0 20px 40px;">
        <p style="margin:0 0 6px;font-size:13px;color:#8898aa;font-weight:600;">سماوي — منصة الكتب الصوتية</p>
        <p style="margin:0;font-size:12px;color:#a0aec0;">© 2026 Samawy. جميع الحقوق محفوظة.</p>
      </td>
    </tr>
  </table>

</body>
</html>`;
}

export function notifyOperatorsEmail(subject: string, body: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><style>
  body { font-family: sans-serif; background: #f5f7fa; margin: 0; padding: 32px 16px; }
  .card { background: #fff; border-radius: 16px; max-width: 480px; margin: 0 auto; padding: 40px; box-shadow: 0 4px 24px rgba(0,0,0,.08); }
</style></head>
<body>
<div class="card">
  <p style="font-size:17px;font-weight:700;margin-bottom:8px;">${subject}</p>
  <p style="color:#555;line-height:1.7;">${body}</p>
</div>
</body>
</html>`;
}

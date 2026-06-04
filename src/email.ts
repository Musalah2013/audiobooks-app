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

const SAMAWY_LOGO_URL = "https://audiobooks.samawy-ops.com/samawy/assets/logo-primary.png";

export function magicLinkEmail(link: string, recipientName?: string, studioLogoUrl?: string): string {
  const name = recipientName ? recipientName : "فريق العمل";
  const studioLogoHtml = studioLogoUrl
    ? `<div style="text-align:center;margin-bottom:20px;"><img src="${studioLogoUrl}" alt="شعار الاستوديو" width="56" height="56" style="border-radius:10px;display:inline-block;vertical-align:middle;"></div>`
    : "";

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>رابط الدخول إلى بوابة سماوي</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f6f8;direction:rtl;text-align:right;">

  <!-- Wrapper -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f6f8;">
    <tr>
      <td align="center" style="padding:40px 16px;">

        <!-- Card -->
        <table width="480" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:480px;background-color:#ffffff;border-radius:16px;border:1px solid #e2e8f0;">
          <tr>
            <td style="padding:40px 32px 32px;">

              <!-- Samawy Logo -->
              <div style="text-align:center;margin-bottom:24px;">
                <img src="${SAMAWY_LOGO_URL}" alt="سماوي" width="120" style="display:inline-block;vertical-align:middle;">
              </div>

              ${studioLogoHtml}

              <!-- Greeting -->
              <p style="margin:0 0 12px;font-family:Arial,Tahoma,sans-serif;font-size:18px;font-weight:bold;color:#1a202c;line-height:26px;">
                مرحباً ${name} 👋
              </p>

              <!-- Message -->
              <p style="margin:0 0 24px;font-family:Arial,Tahoma,sans-serif;font-size:14px;color:#4a5568;line-height:22px;">
                لقد طلبتَ رابط الدخول إلى <strong style="color:#1a202c;">بوابة سماوي للاستوديوهات</strong>. اضغط على الزر أدناه للدخول مباشرة. الرابط صالح لمدة <strong style="color:#1a202c;">24 ساعة</strong> فقط.
              </p>

              <!-- Button (bulletproof for Outlook) -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
                <tr>
                  <td align="center">
                    <table cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td align="center" style="background-color:#0b80ff;border-radius:10px;">
                          <a href="${link}" style="display:inline-block;padding:14px 36px;font-family:Arial,Tahoma,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:10px;">
                            الدخول إلى البوابة
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Divider -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px;">
                <tr><td style="border-top:1px solid #e2e8f0;font-size:0;line-height:0;">&nbsp;</td></tr>
              </table>

              <!-- Security Note -->
              <p style="margin:0;font-family:Arial,Tahoma,sans-serif;font-size:12px;color:#718096;line-height:18px;text-align:center;">
                إذا لم تطلب هذا الرابط، يمكنك تجاهل هذا البريد بأمان.
              </p>

            </td>
          </tr>
        </table>

        <!-- Footer -->
        <table width="480" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:480px;margin-top:20px;">
          <tr>
            <td align="center" style="padding:0 16px;">
              <p style="margin:0 0 4px;font-family:Arial,Tahoma,sans-serif;font-size:12px;color:#718096;font-weight:bold;">سماوي — منصة الكتب الصوتية</p>
              <p style="margin:0;font-family:Arial,Tahoma,sans-serif;font-size:11px;color:#a0aec0;">© 2026 Samawy. جميع الحقوق محفوظة.</p>
            </td>
          </tr>
        </table>

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

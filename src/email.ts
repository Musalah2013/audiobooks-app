export async function sendEmail(options: {
  to: string;
  toName?: string;
  subject: string;
  html: string;
  from?: string;
  fromName?: string;
  resendApiKey?: string;
}): Promise<void> {
  const apiKey = options.resendApiKey;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured. Set it as a Worker secret to enable email sending.");
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: `${options.fromName ?? "Samawy Audiobooks Ops"} <${options.from ?? "noreply@samawy.com"}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Email send failed (${response.status}): ${body}`);
  }
}

export function magicLinkEmail(link: string, recipientName?: string): string {
  const name = recipientName ? `<strong>${recipientName}</strong>` : "there";
  return `
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head><meta charset="utf-8"><style>
  body { font-family: sans-serif; background: #f5f7fa; margin: 0; padding: 32px 16px; }
  .card { background: #fff; border-radius: 16px; max-width: 480px; margin: 0 auto; padding: 40px; box-shadow: 0 4px 24px rgba(0,0,0,.08); }
  .btn { display: inline-block; margin-top: 24px; padding: 14px 32px; background: #0b80ff; color: #fff; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 15px; }
  .note { margin-top: 20px; font-size: 12px; color: #888; }
</style></head>
<body>
<div class="card">
  <p style="font-size:18px;font-weight:700;margin-bottom:8px;">مرحباً ${name}</p>
  <p style="color:#555;line-height:1.7;">اضغط على الزر أدناه للدخول إلى بوابة سماوي. الرابط صالح لمدة 24 ساعة.</p>
  <a class="btn" href="${link}">الدخول إلى البوابة</a>
  <p class="note">إذا لم تطلب هذا الرابط، يمكنك تجاهل هذا البريد.</p>
</div>
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

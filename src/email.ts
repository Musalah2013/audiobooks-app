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
const PORTAL_URL = "https://audiobooks.samawy-ops.com";

function emailWrapper(content: string, footerExtra?: string): string {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
</head>
<body style="margin:0;padding:0;background-color:#f4f6f8;direction:rtl;text-align:right;font-family:Arial,Tahoma,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f6f8;">
    <tr><td align="center" style="padding:40px 16px;">
      <table width="480" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:480px;background-color:#ffffff;border-radius:16px;border:1px solid #e2e8f0;">
        <tr><td style="padding:40px 32px 32px;">
          <!-- Logo -->
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px;">
            <tr><td align="center">
              <img src="${SAMAWY_LOGO_URL}" alt="سماوي" width="120" style="display:block;">
            </td></tr>
          </table>
          ${content}
        </td></tr>
      </table>
      <!-- Footer -->
      <table width="480" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:480px;margin-top:20px;">
        <tr><td align="center" style="padding:0 16px;">
          <p style="margin:0 0 4px;font-size:12px;color:#718096;font-weight:bold;">سماوي — منصة الكتب الصوتية</p>
          <p style="margin:0;font-size:11px;color:#a0aec0;">© 2026 Samawy. جميع الحقوق محفوظة.</p>
          ${footerExtra ? `<p style="margin:8px 0 0;font-size:11px;color:#a0aec0;">${footerExtra}</p>` : ''}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buttonRow(href: string, label: string): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
    <tr><td align="center">
      <table cellpadding="0" cellspacing="0" border="0"><tr>
        <td align="center" style="background-color:#0b80ff;border-radius:10px;">
          <a href="${href}" style="display:inline-block;padding:14px 36px;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:10px;">${label}</a>
        </td>
      </tr></table>
    </td></tr>
  </table>`;
}

function divider(): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0;">
    <tr><td style="border-top:1px solid #e2e8f0;font-size:0;line-height:0;">&nbsp;</td></tr>
  </table>`;
}

export function magicLinkEmail(link: string, recipientName?: string, studioLogoUrl?: string): string {
  const name = recipientName ? recipientName : "فريق العمل";
  const logos = studioLogoUrl
    ? `<table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 20px;"><tr>
        <td style="padding:0 12px;"><img src="${SAMAWY_LOGO_URL}" alt="سماوي" width="120" style="display:block;"></td>
        <td style="padding:0 12px;"><img src="${studioLogoUrl}" alt="شعار الاستوديو" width="56" height="56" style="display:block;border-radius:10px;"></td>
      </tr></table>`
    : `<img src="${SAMAWY_LOGO_URL}" alt="سماوي" width="120" style="display:block;margin:0 auto 20px;">`;

  return emailWrapper(`
    ${logos}
    <p style="margin:0 0 12px;font-size:18px;font-weight:bold;color:#1a202c;line-height:26px;">مرحباً ${name} 👋</p>
    <p style="margin:0 0 20px;font-size:14px;color:#4a5568;line-height:22px;">
      لقد طلبتَ رابط الدخول إلى <strong style="color:#1a202c;">بوابة سماوي للاستوديوهات</strong>. اضغط على الزر أدناه للدخول مباشرة. الرابط صالح لمدة <strong style="color:#1a202c;">24 ساعة</strong> فقط.
    </p>
    ${buttonRow(link, 'الدخول إلى البوابة')}
    ${divider()}
    <p style="margin:0;font-size:12px;color:#718096;line-height:18px;text-align:center;">إذا لم تطلب هذا الرابط، يمكنك تجاهل هذا البريد بأمان.</p>
  `);
}

export function notifyOperatorsEmail(title: string, bodyHtml: string, actionLink?: string, actionLabel?: string): string {
  return emailWrapper(`
    <p style="margin:0 0 16px;font-size:17px;font-weight:700;color:#1a202c;">${title}</p>
    <p style="margin:0 0 20px;font-size:14px;color:#4a5568;line-height:22px;">${bodyHtml}</p>
    ${actionLink && actionLabel ? buttonRow(actionLink, actionLabel) : ''}
  `);
}

export function sampleReviewedEmail(sampleName: string, status: 'approved' | 'refused', reviewNote: string | null, studioName: string): string {
  const isApproved = status === 'approved';
  const statusColor = isApproved ? '#059669' : '#dc2626';
  const statusLabel = isApproved ? 'موافقة' : 'مرفوضة';
  const statusIcon = isApproved ? '✅' : '❌';

  return emailWrapper(`
    <p style="margin:0 0 16px;font-size:18px;font-weight:bold;color:#1a202c;">تحديث حالة العينة ${statusIcon}</p>
    <p style="margin:0 0 12px;font-size:14px;color:#4a5568;line-height:22px;">
      تم مراجعة عينة <strong>"${sampleName}"</strong> من استوديو <strong>${studioName}</strong>.
    </p>
    <div style="background:#f8fafc;border-radius:12px;padding:16px;margin:16px 0;border:1px solid #e2e8f0;">
      <p style="margin:0 0 8px;font-size:13px;color:#64748b;">الحالة:</p>
      <p style="margin:0;font-size:16px;font-weight:bold;color:${statusColor};">${statusLabel}</p>
      ${reviewNote ? `<p style="margin:12px 0 0;font-size:13px;color:#64748b;border-top:1px solid #e2e8f0;padding-top:12px;">ملاحظة المراجعة: ${reviewNote}</p>` : ''}
    </div>
    ${buttonRow(`${PORTAL_URL}/studio/${studioName}`, 'الدخول إلى البوابة')}
  `);
}

export function driveUploadCompleteEmail(fileName: string, studioName: string, driveFileId: string | null): string {
  const driveLink = driveFileId ? `https://drive.google.com/file/d/${driveFileId}` : null;
  return emailWrapper(`
    <p style="margin:0 0 16px;font-size:18px;font-weight:bold;color:#1a202c;">✅ اكتملت المزامنة مع Google Drive</p>
    <p style="margin:0 0 12px;font-size:14px;color:#4a5568;line-height:22px;">
      تم رفع ملف <strong>"${fileName}"</strong> من استوديو <strong>${studioName}</strong> بنجاح إلى Google Drive.
    </p>
    ${driveLink ? buttonRow(driveLink, 'فتح الملف في Drive') : ''}
  `);
}

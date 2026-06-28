import type { SendEmail } from "@cloudflare/workers-types";

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
    const toAddr = options.toName ? `"${options.toName}" <${options.to}>` : options.to;
    const fromAddr = options.fromName ? `"${options.fromName}" <${options.from ?? "noreply@audiobooks.samawy-ops.com"}>` : (options.from ?? "noreply@audiobooks.samawy-ops.com");
    await binding.send({
      to: toAddr,
      from: fromAddr,
      subject: options.subject,
      html: options.html,
    });
  } catch (error) {
    const code = (error as any).code ?? "UNKNOWN";
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Email send failed (${code}): ${message}`);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Redesigned transactional templates (Samawy brand). See docs/email-templates.html.
// ────────────────────────────────────────────────────────────────────────────

// ----------------------------------------------------------------------------
// Brand constants (point these at your hosted assets)
// ----------------------------------------------------------------------------
const ASSET_BASE = 'https://audiobooks.samawy-ops.com/samawy/assets';
const LOGO_DARK_URL = `${ASSET_BASE}/logo-on-dark.png`; // white lockup for navy header
const MARK_URL = `${ASSET_BASE}/icon-blue.png`;         // bookmark mark for footer

const ACCENT = '#0B80FF';   // Samawy Blue — CTA + accents
const INK = '#010B26';      // Midnight Ink — header band + headings
const PAGE_BG = '#f4f6f8';
const BODY_TXT = '#5B6472';
const STRONG_TXT = '#1F2733';

const AR_FONT = "'IBM Plex Sans Arabic','Segoe UI',Tahoma,Arial,sans-serif";
const EN_FONT = "'Hanken Grotesk',-apple-system,'Segoe UI',Arial,sans-serif";

const FONT_LINK =
  '<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap" rel="stylesheet">';

type Lang = 'ar' | 'en';
const isAr = (l: Lang) => l === 'ar';
const fontFor = (l: Lang) => (isAr(l) ? AR_FONT : EN_FONT);

// ----------------------------------------------------------------------------
// Shared building blocks
// ----------------------------------------------------------------------------

/** Book-spine accent strip that opens every card (signature brand texture). */
function spineStrip(accent = ACCENT): string {
  const segs: [string, number][] = [
    [accent, 96], ['#0BC0F1', 64], ['#A9DDF7', 48], [accent, 120],
    ['#F9E866', 40], ['#B5D77A', 56], [accent, 80], ['#0BC0F1', 56],
  ];
  const cells = segs
    .map(([c, w]) => `<td width="${w}" height="8" style="width:${w}px;height:8px;background:${c};font-size:0;line-height:0;mso-line-height-rule:exactly;">&nbsp;</td>`)
    .join('');
  return `<tr><td style="padding:0;font-size:0;line-height:0;border-radius:16px 16px 0 0;overflow:hidden;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;"><tr>${cells}</tr></table></td></tr>`;
}

/** Navy header with the Samawy logo only. */
function simpleHeader(): string {
  return `<tr><td align="center" style="background:${INK};padding:26px 32px;"><img src="${LOGO_DARK_URL}" alt="Samawy" width="120" style="display:block;border:0;outline:none;text-decoration:none;margin:0 auto;"></td></tr>`;
}

/** Navy header with the Samawy logo + a studio chip (logo + name). */
function studioHeader(studio: { initial: string; name: string; sub: string }, lang: Lang): string {
  const align = isAr(lang) ? 'right' : 'left';
  const font = fontFor(lang);
  return `<tr><td align="center" style="background:${INK};padding:26px 32px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;"><tr>
      <td valign="middle" style="padding:0 14px;"><img src="${LOGO_DARK_URL}" alt="Samawy" width="120" style="display:block;border:0;outline:none;text-decoration:none;"></td>
      <td valign="middle" style="padding:0 14px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td align="center" valign="middle" width="44" height="44" style="width:44px;height:44px;background:#13224C;border-radius:11px;color:#9DCFFF;font-size:17px;font-weight:700;font-family:${font};">${studio.initial}</td>
          <td valign="middle" style="padding:0 10px;text-align:${align};">
            <span style="display:block;color:#ffffff;font-size:13px;font-weight:600;font-family:${font};line-height:17px;">${studio.name}</span>
            <span style="display:block;color:#5FAFFF;font-size:11px;font-family:${font};margin-top:1px;">${studio.sub}</span>
          </td>
        </tr></table>
      </td>
    </tr></table>
  </td></tr>`;
}

/** Pill CTA button (table-based, Outlook-safe). */
function emailButton(label: string, href: string, lang: Lang, accent = ACCENT): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 6px;"><tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td align="center" bgcolor="${accent}" style="background:${accent};border-radius:999px;">
        <a href="${href}" style="display:inline-block;padding:15px 42px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:999px;font-family:${fontFor(lang)};">${label}</a>
      </td>
    </tr></table>
  </td></tr></table>`;
}

/** File / asset row with a type badge (DOC / ZIP / MP3 …). */
function infoCard(info: { type: string; name: string; meta: string }, lang: Lang, accent = ACCENT): string {
  const align = isAr(lang) ? 'right' : 'left';
  const font = fontFor(lang);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 8px;"><tr><td style="background:#F7F8FA;border:1px solid #E0E0E0;border-radius:14px;padding:14px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td width="44" valign="middle" style="width:44px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" valign="middle" width="44" height="44" style="width:44px;height:44px;background:#EAF3FF;border-radius:10px;color:${accent};font-size:11px;font-weight:700;font-family:${EN_FONT};letter-spacing:.04em;">${info.type}</td></tr></table></td>
      <td valign="middle" style="padding:0 12px;text-align:${align};">
        <span style="display:block;font-size:14px;font-weight:600;color:${INK};font-family:${font};line-height:20px;word-break:break-word;">${info.name}</span>
        <span style="display:block;font-size:12px;color:#6B6B6B;font-family:${font};margin-top:2px;">${info.meta}</span>
      </td>
    </tr></table>
  </td></tr></table>`;
}

/** Approved / refused status card. */
function statusCard(
  opts: { state: 'approved' | 'refused'; tag: string; label: string; noteLabel: string; note: string },
  lang: Lang,
): string {
  const align = isAr(lang) ? 'right' : 'left';
  const font = fontFor(lang);
  const ap = opts.state === 'approved';
  const col = ap ? '#1E8E50' : '#D32F2F';
  const soft = ap ? '#E7F6E8' : '#FDE5E5';
  const bd = ap ? '#BFE6C9' : '#F5C2C2';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 8px;"><tr><td style="background:${soft};border:1px solid ${bd};border-radius:14px;padding:16px 18px;text-align:${align};">
    <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${col};font-family:${font};">${opts.tag}</p>
    <p style="margin:8px 0 0;font-size:19px;font-weight:700;color:${col};font-family:${font};">${opts.label}</p>
    <p style="margin:14px 0 0;padding-top:13px;border-top:1px solid ${bd};font-size:13px;color:${BODY_TXT};line-height:21px;font-family:${font};"><strong style="color:#3A4150;">${opts.noteLabel}</strong> ${opts.note}</p>
  </td></tr></table>`;
}

/** Eyebrow + heading + paragraph block. */
function intro(eyebrow: string, heading: string, paras: string[], lang: Lang, accent = ACCENT): string {
  const font = fontFor(lang);
  const eb = eyebrow ? `<p style="margin:0 0 9px;font-size:11px;font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:${accent};font-family:${font};">${eyebrow}</p>` : '';
  const h = `<p style="margin:0 0 14px;font-size:21px;font-weight:700;color:${INK};line-height:31px;font-family:${font};">${heading}</p>`;
  const p = paras.map((x) => `<p style="margin:0 0 16px;font-size:15px;color:${BODY_TXT};line-height:24px;font-family:${font};">${x}</p>`).join('');
  return eb + h + p;
}

/** Fine-print line (with hairline above). */
function finePrint(text: string, lang: Lang): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0 0;"><tr><td style="border-top:1px solid #EEEEEE;padding-top:14px;"><p style="margin:0;font-size:12px;color:#9C9C9C;line-height:18px;text-align:center;font-family:${fontFor(lang)};">${text}</p></td></tr></table>`;
}

/** Footer (Samawy mark + name + rights). */
function footer(lang: Lang): string {
  const font = fontFor(lang);
  const name = isAr(lang) ? 'سماوي — منصة الكتب الصوتية' : 'Samawy — Audiobook Platform';
  const rights = isAr(lang) ? '© 2026 سماوي. جميع الحقوق محفوظة.' : '© 2026 Samawy. All rights reserved.';
  return `<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" align="center" style="width:100%;max-width:560px;margin:0 auto;"><tr><td align="center" style="padding:22px 16px 10px;">
    <img src="${MARK_URL}" alt="" width="20" height="20" style="display:inline-block;border:0;opacity:.9;margin-bottom:8px;">
    <p style="margin:0 0 4px;font-size:12px;color:#6B6B6B;font-weight:700;font-family:${font};">${name}</p>
    <p style="margin:0;font-size:11px;color:#9C9C9C;font-family:${font};">${rights}</p>
  </td></tr></table>`;
}

/** Full document shell — wraps a header row + body HTML into a sendable email. */
function shell(opts: { lang: Lang; preheader: string; headerRow: string; bodyInner: string; accent?: string }): string {
  const { lang, preheader, headerRow, bodyInner } = opts;
  const accent = opts.accent ?? ACCENT;
  const dir = isAr(lang) ? 'rtl' : 'ltr';
  const align = isAr(lang) ? 'right' : 'left';
  const bodyRow = `<tr><td style="background:#ffffff;padding:32px 32px 30px;text-align:${align};direction:${dir};">${bodyInner}</td></tr>`;
  const card = `<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" align="center" style="width:100%;max-width:560px;background:#ffffff;border:1px solid #E0E0E0;border-radius:16px;border-collapse:separate;overflow:hidden;">${spineStrip(accent)}${headerRow}${bodyRow}</table>`;
  return `<!DOCTYPE html><html lang="${lang}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><meta http-equiv="X-UA-Compatible" content="IE=edge"><link rel="preconnect" href="https://fonts.googleapis.com">${FONT_LINK}</head>
<body style="margin:0;padding:0;background:${PAGE_BG};direction:${dir};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAGE_BG};"><tr><td align="center" style="padding:40px 16px;">
${card}
${footer(lang)}
</td></tr></table>
</body></html>`;
}

const strip = (html: string) => html.replace(/<[^>]+>/g, '');

// ----------------------------------------------------------------------------
// Public template functions  (mirror existing call sites in src/api/*)
// ----------------------------------------------------------------------------

/**
 * Magic sign-in link. Pass `studio` to render the studio-logo chip in the header
 * (studio portal); omit it for the acquisition portal.
 *   studio-auth.ts / studios.ts  →  magicLinkEmail({ ... , studio })
 *   acquisition-auth.ts          →  magicLinkEmail({ ... })  // no chip
 */
export function magicLinkEmail(opts: {
  lang?: Lang;
  link: string;
  greetingName: string;        // e.g. "استوديو الأمواج" / "Mohammed Salah"
  portalLabel: string;         // e.g. "بوابة سماوي للاستوديوهات"
  ctaLabel: string;            // e.g. "الدخول إلى البوابة" / "Open the Portal"
  eyebrow?: string;
  studio?: { initial: string; name: string; sub: string };
}): string {
  const lang = opts.lang ?? 'ar';
  const headerRow = opts.studio ? studioHeader(opts.studio, lang) : simpleHeader();
  const greeting = isAr(lang) ? `مرحباً، ${opts.greetingName}` : `Welcome, ${opts.greetingName}`;
  const para = isAr(lang)
    ? `لقد طلبتَ رابط الدخول إلى <strong style="color:${STRONG_TXT};">${opts.portalLabel}</strong>. اضغط الزر أدناه للدخول مباشرة دون كلمة مرور. الرابط صالح لمدة <strong style="color:${STRONG_TXT};">24 ساعة</strong> فقط.`
    : `You requested a sign-in link for the <strong style="color:${STRONG_TXT};">${opts.portalLabel}</strong>. Tap the button below to sign in instantly — no password needed. This link is valid for <strong style="color:${STRONG_TXT};">24 hours</strong> only.`;
  const fine = isAr(lang)
    ? 'إذا لم تطلب هذا الرابط، يمكنك تجاهل هذه الرسالة بأمان.'
    : "If you didn't request this link, you can safely ignore this email.";
  const eyebrow = opts.eyebrow ?? (isAr(lang) ? 'تسجيل دخول آمن' : 'Secure sign-in');
  const bodyInner =
    intro(eyebrow, greeting, [para], lang) +
    emailButton(opts.ctaLabel, opts.link, lang) +
    finePrint(fine, lang);
  return shell({ lang, preheader: strip(para), headerRow, bodyInner });
}

/**
 * Generic operator/studio notification with an optional file row.
 *   studios.ts / acquisition-portal.ts  →  new production file
 *   studio-portal.ts                    →  new delivery / new sample
 */
export function notifyEmail(opts: {
  lang?: Lang;
  eyebrow: string;            // e.g. "إشعار للمشغّلين" / "Operator alert"
  heading: string;
  body: string;               // may contain inline <strong>
  ctaLabel: string;
  link: string;
  info?: { type: string; name: string; meta: string };
}): string {
  const lang = opts.lang ?? 'ar';
  const bodyInner =
    intro(opts.eyebrow, opts.heading, [opts.body], lang) +
    (opts.info ? infoCard(opts.info, lang) : '') +
    emailButton(opts.ctaLabel, opts.link, lang);
  return shell({ lang, preheader: strip(opts.body), headerRow: simpleHeader(), bodyInner });
}

/**
 * Sample review result (approved / refused) with the status card.
 *   studios.ts  →  sampleReviewedEmail({ ... })
 */
export function sampleReviewedEmail(opts: {
  lang?: Lang;
  sampleName: string;
  studioName: string;
  status: 'approved' | 'refused';
  reviewNote: string;
  ctaLabel: string;
  link: string;
}): string {
  const lang = opts.lang ?? 'ar';
  const ap = opts.status === 'approved';
  const eyebrow = isAr(lang) ? 'نتيجة المراجعة' : 'Review result';
  const heading = isAr(lang) ? 'تم تحديث حالة العينة' : 'Your sample status was updated';
  const body = isAr(lang)
    ? `تمت مراجعة عينة «<strong style="color:${STRONG_TXT};">${opts.sampleName}</strong>» المقدّمة من <strong style="color:${STRONG_TXT};">${opts.studioName}</strong>.`
    : `The sample “<strong style="color:${STRONG_TXT};">${opts.sampleName}</strong>” submitted by <strong style="color:${STRONG_TXT};">${opts.studioName}</strong> has been reviewed.`;
  const status = {
    state: opts.status,
    tag: eyebrow,
    label: isAr(lang) ? (ap ? 'موافَقة' : 'مرفوضة') : (ap ? 'Approved' : 'Refused'),
    noteLabel: isAr(lang) ? 'ملاحظة المراجعة:' : 'Reviewer note:',
    note: opts.reviewNote,
  };
  const bodyInner =
    intro(eyebrow, heading, [body], lang) +
    statusCard(status, lang) +
    emailButton(opts.ctaLabel, opts.link, lang);
  return shell({ lang, preheader: strip(body), headerRow: simpleHeader(), bodyInner });
}

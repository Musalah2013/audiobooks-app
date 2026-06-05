import { Hono } from 'hono';
import type { Env } from '../types';
import { Repository } from '../db';
import { sendEmail, magicLinkEmail } from '../email';
import { hmacSign } from '../password';
import { signInternalArtifactUrl, nowIso } from '../utils';

const STUDIO_SESSION_COOKIE = '_studiosession';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Simple in-memory rate limiter
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 5; // 5 magic-link requests per minute

function checkRateLimit(ip: string): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, retryAfter: 0 };
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    return { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }
  entry.count += 1;
  return { allowed: true, retryAfter: 0 };
}

export async function createStudioSessionCookie(studioId: string, slug: string, secret: string): Promise<string> {
  const payload = btoa(JSON.stringify({ studioId, slug, exp: Date.now() + SESSION_TTL_MS }));
  const sig = await hmacSign(secret, payload);
  const value = `${payload}.${sig}`;
  return `${STUDIO_SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`;
}

export async function verifyStudioSessionCookie(cookieHeader: string | null, secret: string): Promise<{ studioId: string; slug: string } | null> {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${STUDIO_SESSION_COOKIE}=([^;]+)`));
  if (!match) return null;
  const parts = match[1].split('.');
  if (parts.length < 2) return null;
  const sig = parts.pop()!;
  const payload = parts.join('.');
  const expected = await hmacSign(secret, payload);
  if (expected !== sig) return null;
  try {
    const { studioId, slug, exp } = JSON.parse(atob(payload)) as { studioId: string; slug: string; exp: number };
    if (Date.now() > exp) return null;
    return { studioId, slug };
  } catch {
    return null;
  }
}

export function clearStudioSessionCookie(): string {
  return `${STUDIO_SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

const studioAuth = new Hono<{ Bindings: Env }>();

studioAuth.post('/request', async (c) => {
  const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
  const { allowed, retryAfter } = checkRateLimit(ip);
  if (!allowed) {
    c.header('Retry-After', String(retryAfter));
    return c.json({ error: 'Too many requests. Please try again later.' }, 429);
  }
  const { slug, email } = await c.req.json() as { slug?: string; email?: string };
  if (!slug || !email) return c.json({ error: 'slug and email required' }, 400);
  const repo = new Repository(c.env.DB);
  const studio = await repo.getStudioBySlug(slug);
  if (!studio || !studio.is_active) return c.json({ ok: true }); // silent — don't reveal existence
  if (studio.contact_email.toLowerCase() !== email.toLowerCase()) return c.json({ ok: true }); // silent

  const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await repo.createStudioMagicLink(studio.id, token, expiresAt);

  const baseUrl = c.env.APP_BASE_URL?.replace('samawy-ops.com', 'audiobooks.samawy-ops.com') ?? `https://audiobooks.samawy-ops.com`;
  const link = `${baseUrl}/api/studio-auth/verify?token=${token}`;

  // Build signed studio logo URL if available
  let studioLogoUrl: string | undefined;
  if (studio.logo_object_key) {
    const logoExpiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
    const logoBaseUrl = c.env.APP_BASE_URL?.replace('samawy-ops.com', 'audiobooks.samawy-ops.com') ?? `https://audiobooks.samawy-ops.com`;
    studioLogoUrl = await signInternalArtifactUrl({
      baseUrl: logoBaseUrl,
      path: `/api/files/${studio.logo_object_key}`,
      key: studio.logo_object_key,
      method: 'GET',
      secret: c.env.INTERNAL_API_SECRET,
      expiresAt: logoExpiresAt,
    });
  }

  await sendEmail({
    to: studio.contact_email,
    toName: studio.name,
    subject: 'رابط الدخول إلى بوابة سماوي',
    html: magicLinkEmail(link, studio.name, studioLogoUrl),
    emailBinding: c.env.EMAIL,
  });
  return c.json({ ok: true });
});

studioAuth.get('/verify', async (c) => {
  const token = c.req.query('token');
  const host = new URL(c.req.url).host;
  if (!token) {
    return c.html(`<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"><title>خطأ</title></head><body style="font-family:system-ui;text-align:center;padding:40px"><p>رابط غير صالح. <a href="/">العودة للرئيسية</a></p></body></html>`, 400);
  }
  const repo = new Repository(c.env.DB);
  const result = await repo.verifyAndConsumeStudioMagicLink(token);
  if (!result) {
    return c.html(`<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"><title>خطأ</title></head><body style="font-family:system-ui;text-align:center;padding:40px"><p>رابط غير صالح أو منتهي الصلاحية. <a href="/">العودة للرئيسية</a></p></body></html>`, 400);
  }
  const studio = await repo.getStudio(result.studioId);
  if (!studio) {
    return c.html(`<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"><title>خطأ</title></head><body style="font-family:system-ui;text-align:center;padding:40px"><p>الاستوديو غير موجود.</p></body></html>`, 404);
  }
  const cookie = await createStudioSessionCookie(studio.id, studio.slug, c.env.INTERNAL_API_SECRET);
  c.header('Set-Cookie', cookie);
  const redirectUrl = `/studio/${studio.slug}`;
  // Return HTML page with meta refresh + JS redirect + manual link fallback
  return c.html(`<!DOCTYPE html>
<html dir="rtl">
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="1;url=${redirectUrl}">
  <title>جاري تسجيل الدخول…</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; text-align: center; padding: 60px 20px; background: #f5f7fa; }
    .card { background: white; border-radius: 16px; padding: 40px; max-width: 400px; margin: 0 auto; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
    .spinner { width: 40px; height: 40px; border: 3px solid #e2e8f0; border-top-color: #0b80ff; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 20px; }
    @keyframes spin { to { transform: rotate(360deg); } }
    h1 { font-size: 18px; color: #1e293b; margin-bottom: 8px; }
    p { color: #64748b; font-size: 14px; margin-bottom: 24px; }
    a { color: #0b80ff; text-decoration: none; font-size: 14px; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="card">
    <div class="spinner"></div>
    <h1>جاري تسجيل الدخول…</h1>
    <p>سيتم تحويلك تلقائياً إلى بوابة الاستوديو.</p>
    <a href="${redirectUrl}">اضغط هنا إذا لم يتم التحويل</a>
  </div>
  <script>setTimeout(() => { window.location.href = '${redirectUrl}'; }, 500);</script>
</body>
</html>`);
});

studioAuth.post('/logout', (c) => {
  c.header('Set-Cookie', clearStudioSessionCookie());
  return c.json({ ok: true });
});

export default studioAuth;

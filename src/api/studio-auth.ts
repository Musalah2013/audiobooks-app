import { Hono } from 'hono';
import type { Env } from '../types';
import { Repository } from '../db';
import { sendEmail, magicLinkEmail } from '../email';
import { hmacSign } from '../password';
import { nowIso } from '../utils';

const STUDIO_SESSION_COOKIE = '_studiosession';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

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
  await sendEmail({
    to: studio.contact_email,
    toName: studio.name,
    subject: 'رابط الدخول إلى بوابة سماوي',
    html: magicLinkEmail(link, studio.name),
    emailBinding: c.env.EMAIL,
  });
  return c.json({ ok: true });
});

studioAuth.get('/verify', async (c) => {
  const token = c.req.query('token');
  if (!token) return c.redirect('/');
  const repo = new Repository(c.env.DB);
  const result = await repo.verifyAndConsumeStudioMagicLink(token);
  if (!result) return c.html('<p>رابط غير صالح أو منتهي الصلاحية. <a href="/">العودة</a></p>', 400);
  const studio = await repo.getStudio(result.studioId);
  if (!studio) return c.html('<p>الاستوديو غير موجود.</p>', 404);
  const cookie = await createStudioSessionCookie(studio.id, studio.slug, c.env.INTERNAL_API_SECRET);
  c.header('Set-Cookie', cookie);
  return c.redirect(`/studio/${studio.slug}`);
});

studioAuth.post('/logout', (c) => {
  c.header('Set-Cookie', clearStudioSessionCookie());
  return c.json({ ok: true });
});

export default studioAuth;

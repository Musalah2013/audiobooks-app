import { Hono } from 'hono';
import type { Env } from '../types';
import { Repository } from '../db';
import { sendEmail, magicLinkEmail } from '../email';
import { hmacSign } from '../password';

const ACQUISITION_SESSION_COOKIE = '_acqsession';
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

export async function createAcquisitionSessionCookie(acquisitionUserId: string, secret: string): Promise<string> {
  const payload = btoa(JSON.stringify({ acquisitionUserId, exp: Date.now() + SESSION_TTL_MS }));
  const sig = await hmacSign(secret, payload);
  const value = `${payload}.${sig}`;
  return `${ACQUISITION_SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`;
}

export async function verifyAcquisitionSessionCookie(cookieHeader: string | null, secret: string): Promise<{ acquisitionUserId: string } | null> {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${ACQUISITION_SESSION_COOKIE}=([^;]+)`));
  if (!match) return null;
  const parts = match[1].split('.');
  if (parts.length < 2) return null;
  const sig = parts.pop()!;
  const payload = parts.join('.');
  const expected = await hmacSign(secret, payload);
  if (expected !== sig) return null;
  try {
    const { acquisitionUserId, exp } = JSON.parse(atob(payload)) as { acquisitionUserId: string; exp: number };
    if (Date.now() > exp) return null;
    return { acquisitionUserId };
  } catch {
    return null;
  }
}

export function clearAcquisitionSessionCookie(): string {
  return `${ACQUISITION_SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

const acquisitionAuth = new Hono<{ Bindings: Env }>();

acquisitionAuth.post('/request', async (c) => {
  const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
  const { allowed, retryAfter } = checkRateLimit(ip);
  if (!allowed) {
    c.header('Retry-After', String(retryAfter));
    return c.json({ error: 'Too many requests. Please try again later.' }, 429);
  }
  const { email } = await c.req.json() as { email?: string };
  if (!email) return c.json({ error: 'email required' }, 400);
  const repo = new Repository(c.env.DB);
  const user = await repo.getAcquisitionUserByEmail(email);
  if (!user || !user.is_active) return c.json({ ok: true }); // silent

  const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await repo.createAcquisitionMagicLink(user.id, token, expiresAt);

  const baseUrl = c.env.APP_BASE_URL ?? `https://${new URL(c.req.url).host}`;
  const link = `${baseUrl}/api/acquisition-auth/verify?token=${token}`;
  await sendEmail({
    to: user.email,
    toName: user.name,
    subject: 'رابط الدخول — بوابة الاقتناء',
    html: magicLinkEmail(link, user.name),
    emailBinding: c.env.EMAIL,
  });
  return c.json({ ok: true });
});

acquisitionAuth.get('/verify', async (c) => {
  const token = c.req.query('token');
  if (!token) return c.redirect('/');
  const repo = new Repository(c.env.DB);
  const result = await repo.verifyAndConsumeAcquisitionMagicLink(token);
  if (!result) return c.html('<p>رابط غير صالح أو منتهي الصلاحية. <a href="/">العودة</a></p>', 400);
  const cookie = await createAcquisitionSessionCookie(result.acquisitionUserId, c.env.INTERNAL_API_SECRET);
  c.header('Set-Cookie', cookie);
  return c.redirect('/acquisition');
});

acquisitionAuth.post('/logout', (c) => {
  c.header('Set-Cookie', clearAcquisitionSessionCookie());
  return c.json({ ok: true });
});

export default acquisitionAuth;

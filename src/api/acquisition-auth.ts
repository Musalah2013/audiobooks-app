import { Hono } from 'hono';
import type { Env } from '../types';
import { Repository } from '../db';
import { hmacSign, verifyPassword } from '../password';
import { RateLimiter, loginRateLimiter } from '../rate-limit';

const ACQUISITION_SESSION_COOKIE = '_acqsession';
const ACQUISITION_SESSION_COOKIE_RE = new RegExp(`(?:^|;\\s*)${ACQUISITION_SESSION_COOKIE}=([^;]+)`);
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function createAcquisitionSessionCookie(acquisitionUserId: string, secret: string): Promise<string> {
  const payload = btoa(JSON.stringify({ acquisitionUserId, exp: Date.now() + SESSION_TTL_MS }));
  const sig = await hmacSign(secret, payload);
  const value = `${payload}.${sig}`;
  return `${ACQUISITION_SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`;
}

export async function verifyAcquisitionSessionCookie(cookieHeader: string | null, secret: string): Promise<{ acquisitionUserId: string } | null> {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(ACQUISITION_SESSION_COOKIE_RE);
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

acquisitionAuth.post('/login', async (c) => {
  const ip = RateLimiter.getClientIP(c);
  const { allowed, retryAfter } = loginRateLimiter.check(ip);
  if (!allowed) {
    c.header('Retry-After', String(retryAfter));
    return c.json({ error: 'Too many requests. Please try again later.' }, 429);
  }
  const { email, password } = await c.req.json() as { email?: string; password?: string };
  if (!email || !password) return c.json({ error: 'email and password are required.' }, 400);
  const repo = new Repository(c.env.DB);
  const user = await repo.getAcquisitionUserByEmail(email);
  if (!user || !user.is_active || !user.password_hash || !(await verifyPassword(password, user.password_hash))) {
    return c.json({ error: 'Invalid email or password.' }, 401);
  }
  const cookie = await createAcquisitionSessionCookie(user.id, c.env.INTERNAL_API_SECRET);
  c.header('Set-Cookie', cookie);
  return c.json({ ok: true });
});

acquisitionAuth.post('/logout', (c) => {
  c.header('Set-Cookie', clearAcquisitionSessionCookie());
  return c.json({ ok: true });
});

export default acquisitionAuth;

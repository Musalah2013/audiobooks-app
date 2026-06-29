import { Hono } from 'hono';
import type { Env } from '../types';
import { Repository } from '../db';
import { hmacSign, verifyPassword } from '../password';
import { RateLimiter, loginRateLimiter } from '../rate-limit';

const STUDIO_SESSION_COOKIE = '_studiosession';
const STUDIO_SESSION_COOKIE_RE = new RegExp(`(?:^|;\\s*)${STUDIO_SESSION_COOKIE}=([^;]+)`);
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// The session carries the login identity (email + contactId) so the portal can
// let a user change their own password. contactId === null = the primary contact.
export interface StudioSession { studioId: string; slug: string; email: string; contactId: string | null }

export async function createStudioSessionCookie(session: { studioId: string; slug: string; email: string; contactId: string | null }, secret: string): Promise<string> {
  const payload = btoa(JSON.stringify({ ...session, exp: Date.now() + SESSION_TTL_MS }));
  const sig = await hmacSign(secret, payload);
  const value = `${payload}.${sig}`;
  return `${STUDIO_SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`;
}

export async function verifyStudioSessionCookie(cookieHeader: string | null, secret: string): Promise<StudioSession | null> {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(STUDIO_SESSION_COOKIE_RE);
  if (!match) return null;
  const parts = match[1].split('.');
  if (parts.length < 2) return null;
  const sig = parts.pop()!;
  const payload = parts.join('.');
  const expected = await hmacSign(secret, payload);
  if (expected !== sig) return null;
  try {
    const { studioId, slug, email, contactId, exp } = JSON.parse(atob(payload)) as StudioSession & { exp: number };
    if (Date.now() > exp) return null;
    return { studioId, slug, email: email ?? '', contactId: contactId ?? null };
  } catch {
    return null;
  }
}

export function clearStudioSessionCookie(): string {
  return `${STUDIO_SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

const studioAuth = new Hono<{ Bindings: Env }>();

// Password login. Identifier is the email of the studio's primary contact
// (studio.password_hash) or any additional studio_contact (its password_hash).
studioAuth.post('/login', async (c) => {
  const ip = RateLimiter.getClientIP(c);
  const { allowed, retryAfter } = loginRateLimiter.check(ip);
  if (!allowed) {
    c.header('Retry-After', String(retryAfter));
    return c.json({ error: 'Too many requests. Please try again later.' }, 429);
  }
  const { slug, email, password } = await c.req.json() as { slug?: string; email?: string; password?: string };
  if (!slug || !email || !password) return c.json({ error: 'slug, email and password are required.' }, 400);
  const repo = new Repository(c.env.DB);
  const studio = await repo.getStudioBySlug(slug);
  if (!studio || !studio.is_active) return c.json({ error: 'Invalid email or password.' }, 401);

  // Resolve the login: primary contact (on the studio row) or an additional contact.
  let hash: string | null = null;
  let contactId: string | null = null;
  if (studio.contact_email.toLowerCase() === email.toLowerCase()) {
    hash = studio.password_hash;
  } else {
    const contact = await repo.getStudioContactByEmail(studio.id, email);
    if (contact) { hash = contact.password_hash; contactId = contact.id; }
  }
  if (!hash || !(await verifyPassword(password, hash))) {
    return c.json({ error: 'Invalid email or password.' }, 401);
  }

  const cookie = await createStudioSessionCookie({ studioId: studio.id, slug: studio.slug, email: email.toLowerCase(), contactId }, c.env.INTERNAL_API_SECRET);
  c.header('Set-Cookie', cookie);
  await repo.audit('studio', studio.id, 'studio.login', email.toLowerCase(), { contactId }).catch(() => undefined);
  return c.json({ ok: true, slug: studio.slug });
});

studioAuth.post('/logout', (c) => {
  c.header('Set-Cookie', clearStudioSessionCookie());
  return c.json({ ok: true });
});

export default studioAuth;

import { Hono, type Context, type Next } from 'hono';
import { z } from 'zod';
import { Repository } from '../db';
import type { Env, UserPermission, OperatorUser } from '../types';
import { ALL_PERMISSIONS } from '../types';
import { verifyInternalArtifactRequest, verifyMultipartRequest, verifyDossierToken } from '../utils';
import { createSessionCookie, verifySessionCookie, clearSessionCookie, hashPassword, verifyPassword, SESSION_COOKIE } from '../password';
import { verifyStudioSessionCookie } from './studio-auth';
import { RateLimiter, loginRateLimiter, bootstrapRateLimiter } from '../rate-limit';

const auth = new Hono<{ Bindings: Env; Variables: { user: OperatorUser | null } }>();

export function hasPermission(user: OperatorUser | null, permission: UserPermission): boolean {
  if (!user) return false;
  return user.permissions.includes(permission);
}

export function actorEmail(request: Request): string {
  return request.headers.get("cf-access-authenticated-user-email") ?? "operator@local";
}

export async function resolveUser(c: Context<any>): Promise<OperatorUser | null> {
  const email = actorEmail(c.req.raw);
  if (email === "operator@local" && c.env.APP_ENV === "development") {
    return { email: "admin@samawy.com", permissions: ALL_PERMISSIONS, name: "Dev Admin", isActive: true, createdAt: new Date().toISOString() };
  }
  const repo = new Repository(c.env.DB);
  // Session cookie takes precedence (password-based login)
  const cookieEmail = await verifySessionCookie(c.req.header('Cookie') ?? null, c.env.INTERNAL_API_SECRET);
  if (cookieEmail) {
    const user = await repo.getOperatorUser(cookieEmail);
    if (user?.isActive) return { email: user.email, permissions: user.permissions, name: user.name ?? null, isActive: user.isActive, createdAt: user.createdAt };
  }
  // CF Access identity
  if (email !== "operator@local") {
    const user = await repo.getOperatorUser(email);
    if (user?.isActive) return { email: user.email, permissions: user.permissions, name: user.name ?? null, isActive: user.isActive, createdAt: user.createdAt };
  }
  return null;
}

export async function authMiddleware(c: Context<{ Bindings: Env; Variables: { user: OperatorUser | null } }>, next: Next) {
  const path = c.req.path;
  const cookieHeader = c.req.header('Cookie') ?? null;

  // Public auth endpoints (mounted before middleware, but defense-in-depth)
  if (path === '/api/studio-auth/login' || path === '/api/studio-auth/logout' ||
      path === '/api/acquisition-auth/login' || path === '/api/acquisition-auth/logout') {
    return next();
  }

  // Portal routes enforce their OWN session auth inside each handler (returning a
  // proper 401 Unauthorized). Let them through here so unauthenticated requests
  // get the portal's login response instead of the operator "Authentication
  // required" 401 — which the portal login screens would not recognise.
  if (path === '/api/studio-portal' || path.startsWith('/api/studio-portal/') ||
      path === '/api/acquisition-portal' || path.startsWith('/api/acquisition-portal/')) {
    return next();
  }

  const internalSecret = c.req.header('X-Internal-Secret');
  if (internalSecret === c.env.INTERNAL_API_SECRET) {
    return next();
  }

  // Permanent dossier links embedded in ClickUp tasks — public, validated by a
  // per-book token (no expiry, no fragile path signing).
  const dossierMatch = path.match(/^\/api\/books\/([^/]+)\/dossier\/([^/]+)$/);
  if (dossierMatch && c.req.query('t')) {
    const ok = await verifyDossierToken(c.env.INTERNAL_API_SECRET, dossierMatch[1], dossierMatch[2], c.req.query('t')!);
    if (ok) return next();
  }

  // Signed links bypass auth (used by ClickUp file links and container downloads/uploads)
  if (c.req.query('sig')) {
    const url = new URL(c.req.url);
    const secret = c.env.INTERNAL_API_SECRET;
    const method = c.req.method;
    if (path.startsWith('/api/files/') || path === '/api/internal/artifacts' || path.startsWith('/api/local-upload/')) {
      const result = await verifyInternalArtifactRequest({ url, secret, method });
      if (result.ok) return next();
    } else if (path.startsWith('/api/internal/multipart-')) {
      const result = await verifyMultipartRequest({ url, secret, method });
      if (result.ok) return next();
    }
  }

  if (c.env.APP_ENV === 'development') {
    c.set("user", await resolveUser(c));
    return next();
  }

  // Studio session cookie auth — ONLY for studio portal routes belonging to the session
  const studioSession = await verifyStudioSessionCookie(cookieHeader, c.env.INTERNAL_API_SECRET);
  if (studioSession) {
    const isOwnPortal = path.startsWith(`/api/studio-portal/${studioSession.slug}`);
    if (isOwnPortal) return next();
    // Otherwise fall through to operator auth checks
  }

  // Session cookie auth (password-based login)
  const cookieEmail = await verifySessionCookie(cookieHeader, c.env.INTERNAL_API_SECRET);
  if (cookieEmail) {
    const repo = new Repository(c.env.DB);
    const user = await repo.getOperatorUser(cookieEmail);
    if (user?.isActive) {
      c.set("user", { email: user.email, permissions: user.permissions, name: user.name ?? null, isActive: user.isActive, createdAt: user.createdAt });
      return next();
    }
  }

  // CF Access JWT auth
  const jwt = c.req.header('CF-Access-Jwt-Assertion');
  const email = actorEmail(c.req.raw);

  if (!jwt || email === "operator@local") {
    return c.json({ error: 'Authentication required' }, 401);
  }

  const user = await resolveUser(c);
  if (!user) {
    return c.json({ error: 'User not registered. Contact an admin.' }, 403);
  }

  c.set("user", user);
  return next();
}

export function requirePermission(permission: UserPermission) {
  return async (c: Context<{ Bindings: Env; Variables: { user: OperatorUser | null } }>, next: Next) => {
    const user = c.get("user");
    if (!user || !hasPermission(user, permission)) {
      return c.json({ error: `Requires ${permission} permission` }, 403);
    }
    return next();
  };
}

// The studios flow is gated by its own `studios` permission, granted per user in
// Users settings (existing admins were backfilled so they keep access).
export function requireStudiosAccess() {
  return async (c: Context<{ Bindings: Env; Variables: { user: OperatorUser | null } }>, next: Next) => {
    const user = c.get("user");
    if (!user || !hasPermission(user, 'studios')) {
      return c.json({ error: 'Requires studios permission' }, 403);
    }
    return next();
  };
}

// ─── Auth API Routes ───────────────────────────────────────────────

auth.get('/me', async (c) => {
  // Check session cookie first, then CF Access
  const cookieEmail = await verifySessionCookie(c.req.header('Cookie') ?? null, c.env.INTERNAL_API_SECRET);
  if (cookieEmail) {
    const repo = new Repository(c.env.DB);
    const u = await repo.getOperatorUser(cookieEmail);
    if (u?.isActive) return c.json({ user: { email: u.email, permissions: u.permissions, name: u.name } });
  }
  const user = await resolveUser(c);
  if (!user) return c.json({ user: null }, 401);
  return c.json({ user });
});

auth.post('/login', async (c) => {
  const ip = RateLimiter.getClientIP(c);
  const { allowed, retryAfter } = loginRateLimiter.check(ip);
  if (!allowed) {
    c.header('Retry-After', String(retryAfter));
    return c.json({ error: 'Too many requests. Please try again later.' }, 429);
  }
  const body = await c.req.json();
  const { email, password } = z.object({
    email: z.string().email(),
    password: z.string().min(1),
  }).parse(body);

  const repo = new Repository(c.env.DB);
  const user = await repo.getOperatorUser(email);
  if (!user?.isActive || !user.passwordHash) {
    return c.json({ error: 'Invalid email or password.' }, 401);
  }
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return c.json({ error: 'Invalid email or password.' }, 401);
  }

  const cookie = await createSessionCookie(email, c.env.INTERNAL_API_SECRET);
  c.header('Set-Cookie', cookie);
  return c.json({ ok: true, user: { email: user.email, permissions: user.permissions, name: user.name } });
});

auth.post('/logout', async (c) => {
  c.header('Set-Cookie', clearSessionCookie());
  return c.json({ ok: true });
});

auth.post('/set-password', async (c) => {
  const ip = RateLimiter.getClientIP(c);
  const { allowed, retryAfter } = loginRateLimiter.check(ip);
  if (!allowed) {
    c.header('Retry-After', String(retryAfter));
    return c.json({ error: 'Too many requests. Please try again later.' }, 429);
  }
  const caller = await resolveUser(c);
  if (!caller) return c.json({ error: 'Authentication required' }, 401);

  const body = await c.req.json();
  const { targetEmail, password } = z.object({
    targetEmail: z.string().email(),
    password: z.string().min(8, 'Password must be at least 8 characters'),
  }).parse(body);

  const isAdmin = caller.permissions.includes('users');
  if (!isAdmin && caller.email !== targetEmail) {
    return c.json({ error: 'You can only set your own password.' }, 403);
  }

  const repo = new Repository(c.env.DB);
  const target = await repo.getOperatorUser(targetEmail);
  if (!target) return c.json({ error: 'User not found.' }, 404);

  const hash = await hashPassword(password);
  await repo.setPasswordHash(targetEmail, hash);
  return c.json({ ok: true });
});

auth.post('/bootstrap', async (c) => {
  const ip = RateLimiter.getClientIP(c);
  const { allowed, retryAfter } = bootstrapRateLimiter.check(ip);
  if (!allowed) {
    c.header('Retry-After', String(retryAfter));
    return c.json({ error: 'Too many requests. Please try again later.' }, 429);
  }
  const email = actorEmail(c.req.raw);
  if (email === 'operator@local') {
    return c.json({ error: 'Cannot bootstrap without a real authenticated identity' }, 400);
  }
  const repo = new Repository(c.env.DB);
  const existing = await repo.listOperatorUsers();
  if (existing.length > 0) {
    return c.json({ error: 'Already bootstrapped' }, 409);
  }
  const user = await repo.upsertOperatorUser({ email, permissions: ALL_PERMISSIONS, isActive: true });
  await repo.logOperatorAudit({
    actorEmail: email,
    action: 'user.bootstrap',
    resourceType: 'operator_user',
    resourceId: email,
    details: { permissions: ALL_PERMISSIONS },
  });
  return c.json({ user });
});

auth.get('/users', async (c) => {
  const user = await resolveUser(c);
  if (!hasPermission(user, 'users')) {
    return c.json({ error: 'Requires users permission' }, 403);
  }
  const repo = new Repository(c.env.DB);
  const users = await repo.listOperatorUsers();
  return c.json({ users });
});

auth.post('/users', async (c) => {
  const actor = await resolveUser(c);
  if (!hasPermission(actor, 'users')) {
    return c.json({ error: 'Requires users permission' }, 403);
  }

  const body = await c.req.json();
  const parsed = z.object({
    email: z.string().email(),
    name: z.string().optional(),
    permissions: z.array(z.enum(['intake', 'metadata', 'matching', 'processing', 'dossier', 'users', 'studios'])),
  }).parse(body);

  const repo = new Repository(c.env.DB);
  const user = await repo.upsertOperatorUser({
    email: parsed.email,
    name: parsed.name ?? null,
    permissions: parsed.permissions as UserPermission[],
    isActive: true,
  });

  await repo.logOperatorAudit({
    actorEmail: actor!.email,
    action: 'user.create',
    resourceType: 'operator_user',
    resourceId: parsed.email,
    details: { permissions: parsed.permissions },
  });

  return c.json({ user });
});

auth.delete('/users/:email', async (c) => {
  const actor = await resolveUser(c);
  if (!hasPermission(actor, 'users')) return c.json({ error: 'Requires users permission' }, 403);
  const email = c.req.param('email');
  if (actor!.email === email) return c.json({ error: 'Cannot delete your own account.' }, 400);
  const repo = new Repository(c.env.DB);
  const existing = await repo.getOperatorUser(email);
  if (!existing) return c.json({ error: 'User not found' }, 404);
  await repo.deleteOperatorUser(email);
  return c.json({ ok: true });
});

auth.patch('/users/:email', async (c) => {
  const actor = await resolveUser(c);
  if (!hasPermission(actor, 'users')) {
    return c.json({ error: 'Requires users permission' }, 403);
  }

  const email = c.req.param('email');
  const body = await c.req.json();
  const parsed = z.object({
    name: z.string().optional(),
    permissions: z.array(z.enum(['intake', 'metadata', 'matching', 'processing', 'dossier', 'users', 'studios'])).optional(),
    isActive: z.boolean().optional(),
  }).parse(body);

  const repo = new Repository(c.env.DB);
  const existing = await repo.getOperatorUser(email);
  if (!existing) {
    return c.json({ error: 'User not found' }, 404);
  }
  const user = await repo.upsertOperatorUser({
    email,
    name: parsed.name ?? existing.name ?? null,
    permissions: (parsed.permissions as UserPermission[] | undefined) ?? existing.permissions,
    isActive: parsed.isActive ?? existing.isActive,
  });

  await repo.logOperatorAudit({
    actorEmail: actor!.email,
    action: 'user.update',
    resourceType: 'operator_user',
    resourceId: email,
    details: parsed,
  });

  return c.json({ user });
});

export default auth;

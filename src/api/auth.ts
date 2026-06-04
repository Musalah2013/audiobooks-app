import { Hono, type Context, type Next } from 'hono';
import { z } from 'zod';
import { Repository } from '../db';
import type { Env, UserPermission, OperatorUser } from '../types';
import { ALL_PERMISSIONS } from '../types';
import { verifyInternalArtifactRequest, verifyMultipartRequest } from '../utils';
import { createSessionCookie, verifySessionCookie, clearSessionCookie, hashPassword, verifyPassword, SESSION_COOKIE } from '../password';

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
    return { email: "admin@samawy.com", permissions: ALL_PERMISSIONS, name: "Dev Admin" };
  }
  const repo = new Repository(c.env.DB);
  // Session cookie takes precedence (password-based login)
  const cookieEmail = await verifySessionCookie(c.req.header('Cookie') ?? null, c.env.INTERNAL_API_SECRET);
  if (cookieEmail) {
    const user = await repo.getOperatorUser(cookieEmail);
    if (user?.isActive) return { email: user.email, permissions: user.permissions, name: user.name ?? undefined };
  }
  // CF Access identity
  if (email !== "operator@local") {
    const user = await repo.getOperatorUser(email);
    if (user?.isActive) return { email: user.email, permissions: user.permissions, name: user.name ?? undefined };
  }
  return null;
}

export async function authMiddleware(c: Context<{ Bindings: Env; Variables: { user: OperatorUser | null } }>, next: Next) {
  const internalSecret = c.req.header('X-Internal-Secret');
  if (internalSecret === c.env.INTERNAL_API_SECRET) {
    return next();
  }

  // Signed links bypass auth (used by ClickUp file links and container downloads/uploads)
  if (c.req.query('sig')) {
    const url = new URL(c.req.url);
    const path = c.req.path;
    const secret = c.env.INTERNAL_API_SECRET;
    const method = c.req.method;
    if (path.startsWith('/api/files/') || path === '/api/internal/artifacts') {
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

  // Session cookie auth (password-based login)
  const cookieEmail = await verifySessionCookie(c.req.header('Cookie') ?? null, c.env.INTERNAL_API_SECRET);
  if (cookieEmail) {
    const repo = new Repository(c.env.DB);
    const user = await repo.getOperatorUser(cookieEmail);
    if (user?.isActive) {
      c.set("user", { email: user.email, permissions: user.permissions, name: user.name ?? undefined });
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
    permissions: z.array(z.enum(['intake', 'metadata', 'matching', 'processing', 'dossier', 'users'])),
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
    permissions: z.array(z.enum(['intake', 'metadata', 'matching', 'processing', 'dossier', 'users'])).optional(),
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

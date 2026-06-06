import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../types';
import { Repository } from '../db';
import { requirePermission, actorEmail } from './auth';
import { createUploadUrl } from '../pipeline';
import { sendEmail, magicLinkEmail, notifyOperatorsEmail, sampleReviewedEmail } from '../email';
import { keySegments, nowIso, signInternalArtifactUrl, extractDriveFolderId } from '../utils';

const studios = new Hono<{ Bindings: Env }>();

function studioToApi(s: { id: string; name: string; slug: string; contact_email: string; drive_folder_id: string | null; logo_object_key: string | null; is_active: number; created_at: string; created_by: string }) {
  return { id: s.id, name: s.name, slug: s.slug, contactEmail: s.contact_email, driveFolderId: s.drive_folder_id, logoObjectKey: s.logo_object_key, isActive: !!s.is_active, createdAt: s.created_at, createdBy: s.created_by };
}

function assetToApi(a: { id: string; studio_id: string; name: string; object_key: string; content_type: string; size_bytes: number; uploaded_by: string; created_at: string }) {
  return { id: a.id, studioId: a.studio_id, name: a.name, objectKey: a.object_key, contentType: a.content_type, sizeBytes: a.size_bytes, uploadedBy: a.uploaded_by, createdAt: a.created_at };
}

function sampleToApi(s: { id: string; studio_id: string; name: string; object_key: string; content_type: string; size_bytes: number; status: string; reviewed_by: string | null; review_note: string | null; reviewed_at: string | null; created_at: string }) {
  return { id: s.id, studioId: s.studio_id, name: s.name, objectKey: s.object_key, contentType: s.content_type, sizeBytes: s.size_bytes, status: s.status as 'pending' | 'approved' | 'refused', reviewedBy: s.reviewed_by, reviewNote: s.review_note, reviewedAt: s.reviewed_at, createdAt: s.created_at };
}

// ─── Studios CRUD ─────────────────────────────────────────────────────────────

studios.get('/', requirePermission('users'), async (c) => {
  const repo = new Repository(c.env.DB);
  const list = await repo.listStudios();
  return c.json({ studios: list.map(studioToApi) });
});

studios.get('/:id', requirePermission('users'), async (c) => {
  const repo = new Repository(c.env.DB);
  const studio = await repo.getStudio(c.req.param('id')!);
  if (!studio) return c.json({ error: 'Not found' }, 404);
  const [assets, productionFiles, samples] = await Promise.all([
    repo.listStudioAssets(studio.id),
    repo.listStudioProductionFiles(studio.id),
    repo.listStudioSamples(studio.id),
  ]);
  return c.json({
    studio: studioToApi(studio),
    assets: assets.map(assetToApi),
    productionFiles: productionFiles.map(assetToApi),
    samples: samples.map(sampleToApi),
  });
});

studios.post('/', requirePermission('users'), async (c) => {
  const body = z.object({
    name: z.string().min(1),
    slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
    contactEmail: z.string().email(),
    driveFolderId: z.string().optional(),
  }).parse(await c.req.json());
  const repo = new Repository(c.env.DB);
  const studio = await repo.createStudio({ id: crypto.randomUUID(), name: body.name, slug: body.slug, contactEmail: body.contactEmail, driveFolderId: extractDriveFolderId(body.driveFolderId) ?? undefined, createdBy: actorEmail(c.req.raw) });
  return c.json({ ok: true, studio: studio ? studioToApi(studio) : null }, 201);
});

studios.patch('/:id', requirePermission('users'), async (c) => {
  const body = z.object({
    name: z.string().min(1).optional(),
    slug: z.string().regex(/^[a-z0-9-]+$/).optional(),
    contactEmail: z.string().email().optional(),
    driveFolderId: z.string().nullable().optional(),
    isActive: z.boolean().optional(),
  }).parse(await c.req.json());
  const repo = new Repository(c.env.DB);
  await repo.updateStudio(c.req.param('id')!, {
    name: body.name,
    slug: body.slug,
    contactEmail: body.contactEmail,
    driveFolderId: extractDriveFolderId(body.driveFolderId) ?? undefined,
    isActive: body.isActive !== undefined ? (body.isActive ? 1 : 0) : undefined,
  });
  const studio = await repo.getStudio(c.req.param('id')!);
  return c.json({ ok: true, studio: studio ? studioToApi(studio) : null });
});

studios.delete('/:id', requirePermission('users'), async (c) => {
  const repo = new Repository(c.env.DB);
  await repo.deleteStudio(c.req.param('id')!);
  return c.json({ ok: true });
});

// ─── Magic link ───────────────────────────────────────────────────────────────

studios.post('/:id/magic-link', requirePermission('users'), async (c) => {
  const repo = new Repository(c.env.DB);
  const studio = await repo.getStudio(c.req.param('id')!);
  if (!studio) return c.json({ error: 'Studio not found' }, 404);
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

  await sendEmail({ to: studio.contact_email, toName: studio.name, subject: 'رابط الدخول إلى بوابة سماوي', html: magicLinkEmail(link, studio.name, studioLogoUrl), emailBinding: c.env.EMAIL });
  return c.json({ ok: true });
});

// ─── Logo upload ──────────────────────────────────────────────────────────────

studios.post('/:id/logo-upload-url', requirePermission('users'), async (c) => {
  const { contentType } = z.object({ contentType: z.string() }).parse(await c.req.json());
  const id = c.req.param('id')!;
  const key = keySegments('studios', id, 'logo');
  const upload = await createUploadUrl(c.env, key, contentType);
  const repo = new Repository(c.env.DB);
  await repo.updateStudio(id, { logoObjectKey: key });
  return c.json({ ...upload, objectKey: key });
});

// ─── Assets ───────────────────────────────────────────────────────────────────

studios.post('/:id/asset-upload-url', requirePermission('users'), async (c) => {
  const { fileName, contentType, sizeBytes } = z.object({ fileName: z.string(), contentType: z.string(), sizeBytes: z.number().optional() }).parse(await c.req.json());
  const studioId = c.req.param('id')!;
  const repo = new Repository(c.env.DB);
  const studio = await repo.getStudio(studioId);
  if (!studio) return c.json({ error: 'Studio not found' }, 404);
  const key = keySegments('studios', studioId, 'assets', `${Date.now()}-${fileName}`);
  const upload = await createUploadUrl(c.env, key, contentType);
  const assetId = await repo.createStudioAsset({ studioId, name: fileName, objectKey: key, contentType, sizeBytes: sizeBytes ?? 0, uploadedBy: actorEmail(c.req.raw) });
  return c.json({ ...upload, objectKey: key, assetId });
});

studios.get('/:id/assets', requirePermission('users'), async (c) => {
  const repo = new Repository(c.env.DB);
  const assets = await repo.listStudioAssets(c.req.param('id')!);
  return c.json({ assets: assets.map(assetToApi) });
});

studios.delete('/:id/assets/:assetId', requirePermission('users'), async (c) => {
  const repo = new Repository(c.env.DB);
  const deleted = await repo.deleteStudioAsset(c.req.param('assetId')!);
  if (deleted?.object_key) await c.env.ASSET_BUCKET.delete(deleted.object_key);
  return c.json({ ok: true });
});

// ─── Production files ─────────────────────────────────────────────────────────

studios.post('/:id/production-file-upload-url', requirePermission('users'), async (c) => {
  const { fileName, contentType, sizeBytes } = z.object({ fileName: z.string(), contentType: z.string().default('application/pdf'), sizeBytes: z.number().optional() }).parse(await c.req.json());
  const studioId = c.req.param('id')!;
  const repo = new Repository(c.env.DB);
  const studio = await repo.getStudio(studioId);
  if (!studio) return c.json({ error: 'Studio not found' }, 404);
  const key = keySegments('studios', studioId, 'production', `${Date.now()}-${fileName}`);
  const upload = await createUploadUrl(c.env, key, contentType);
  const fileId = await repo.createStudioProductionFile({ studioId, name: fileName, objectKey: key, contentType, sizeBytes: sizeBytes ?? 0, uploadedBy: actorEmail(c.req.raw) });
  // Notify studio
  const baseUrl = c.env.APP_BASE_URL?.replace('samawy-ops.com', 'audiobooks.samawy-ops.com') ?? `https://audiobooks.samawy-ops.com`;
  await sendEmail({
    to: studio.contact_email, toName: studio.name,
    subject: 'ملف إنتاج جديد متاح في بوابتك',
    html: notifyOperatorsEmail(
      'ملف إنتاج جديد',
      `تم رفع ملف جديد بعنوان "<strong>${fileName}</strong>" إلى بوابة ${studio.name}.`,
      `${baseUrl}/studio/${studio.slug}`,
      'الدخول إلى البوابة'
    ),
    emailBinding: c.env.EMAIL,
  });
  return c.json({ ...upload, objectKey: key, fileId });
});

studios.delete('/:id/production-files/:fileId', requirePermission('users'), async (c) => {
  const repo = new Repository(c.env.DB);
  const deleted = await repo.deleteStudioProductionFile(c.req.param('fileId')!);
  if (deleted?.object_key) await c.env.ASSET_BUCKET.delete(deleted.object_key);
  return c.json({ ok: true });
});

// ─── Samples ──────────────────────────────────────────────────────────────────

studios.get('/:id/samples', requirePermission('users'), async (c) => {
  const repo = new Repository(c.env.DB);
  const samples = await repo.listStudioSamples(c.req.param('id')!);
  return c.json({ samples: samples.map(sampleToApi) });
});

studios.post('/:id/samples/:sampleId/review', requirePermission('users'), async (c) => {
  const { status, note } = z.object({ status: z.enum(['approved', 'refused']), note: z.string().nullable().optional() }).parse(await c.req.json());
  const studioId = c.req.param('id')!;
  const sampleId = c.req.param('sampleId')!;
  const repo = new Repository(c.env.DB);
  const studio = await repo.getStudio(studioId);
  const sample = await repo.getStudioSample(sampleId);
  if (!studio || !sample) return c.json({ error: 'Not found' }, 404);
  await repo.reviewStudioSample(sampleId, status, actorEmail(c.req.raw), note ?? null);
  const baseUrl = c.env.APP_BASE_URL?.replace('samawy-ops.com', 'audiobooks.samawy-ops.com') ?? `https://audiobooks.samawy-ops.com`;
  const statusAr = status === 'approved' ? 'موافقة' : 'رفض';
  await sendEmail({
    to: studio.contact_email, toName: studio.name,
    subject: `تحديث حالة العينة — ${statusAr}`,
    html: sampleReviewedEmail(sample.name, status, note ?? null, studio.name),
    emailBinding: c.env.EMAIL,
  });
  return c.json({ ok: true });
});

// ─── Acquisition users ────────────────────────────────────────────────────────

studios.get('/acquisition-users', requirePermission('users'), async (c) => {
  const repo = new Repository(c.env.DB);
  const users = await repo.listAcquisitionUsers();
  return c.json({ users: users.map((u) => ({ id: u.id, email: u.email, name: u.name, isActive: !!u.is_active, createdAt: u.created_at })) });
});

studios.post('/acquisition-users', requirePermission('users'), async (c) => {
  const { email, name } = z.object({ email: z.string().email(), name: z.string().min(1) }).parse(await c.req.json());
  const repo = new Repository(c.env.DB);
  const id = await repo.createAcquisitionUser({ email, name, createdBy: actorEmail(c.req.raw) });
  return c.json({ ok: true, id }, 201);
});

studios.patch('/acquisition-users/:id', requirePermission('users'), async (c) => {
  const { name, isActive } = z.object({ name: z.string().min(1).optional(), isActive: z.boolean().optional() }).parse(await c.req.json());
  const repo = new Repository(c.env.DB);
  await repo.updateAcquisitionUser(c.req.param('id')!, { name, isActive: isActive !== undefined ? (isActive ? 1 : 0) : undefined });
  return c.json({ ok: true });
});

studios.post('/acquisition-users/:id/magic-link', requirePermission('users'), async (c) => {
  const repo = new Repository(c.env.DB);
  const user = await repo.getAcquisitionUser(c.req.param('id')!);
  if (!user) return c.json({ error: 'User not found' }, 404);
  const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await repo.createAcquisitionMagicLink(user.id, token, expiresAt);
  const baseUrl = c.env.APP_BASE_URL ?? `https://${new URL(c.req.url).host}`;
  const link = `${baseUrl}/api/acquisition-auth/verify?token=${token}`;
  await sendEmail({ to: user.email, toName: user.name, subject: 'رابط الدخول — بوابة الاقتناء', html: magicLinkEmail(link, user.name), emailBinding: c.env.EMAIL });
  return c.json({ ok: true });
});

export default studios;

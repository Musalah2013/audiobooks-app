import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { Env } from '../types';
import { Repository } from '../db';
import { verifyStudioSessionCookie } from './studio-auth';
import { createUploadUrl } from '../pipeline';
import { signInternalArtifactUrl, signMultipartUrl } from '../utils';
import { sendEmail, notifyEmail } from '../email';
import { keySegments, nowIso, safeStorageName } from '../utils';
import { hashPassword, verifyPassword } from '../password';

const studioPortal = new Hono<{ Bindings: Env }>();

// A signed-in studio user changes their own password.
studioPortal.post('/:slug/change-password', async (c) => {
  const slug = c.req.param('slug');
  const session = await verifyStudioSessionCookie(c.req.header('Cookie') ?? null, c.env.INTERNAL_API_SECRET);
  if (!session || session.slug !== slug) return c.json({ error: 'Unauthorized' }, 401);
  const { currentPassword, newPassword } = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8) }).parse(await c.req.json());
  const repo = new Repository(c.env.DB);
  const studio = await repo.getStudio(session.studioId);
  if (!studio) return c.json({ error: 'Not found' }, 404);
  // Resolve which credential this session represents.
  const isPrimary = session.contactId == null;
  const currentHash = isPrimary ? studio.password_hash : (await repo.getStudioContact(session.contactId!))?.password_hash ?? null;
  if (!currentHash || !(await verifyPassword(currentPassword, currentHash))) {
    return c.json({ error: 'Current password is incorrect.' }, 400);
  }
  const hash = await hashPassword(newPassword);
  if (isPrimary) await repo.setStudioPassword(studio.id, hash);
  else await repo.setStudioContactPassword(session.contactId!, hash);
  await repo.audit('studio', studio.id, 'studio.password_changed', session.email || 'studio', {}).catch(() => undefined);
  return c.json({ ok: true });
});

async function requireStudioSession(c: Context<{ Bindings: Env }>, slug: string) {
  const session = await verifyStudioSessionCookie(c.req.header('Cookie') ?? null, c.env.INTERNAL_API_SECRET);
  if (!session || session.slug !== slug) return null;
  return session;
}

function safeJson(raw: string) {
  try { return JSON.parse(raw); } catch { return null; }
}

function driveUploadToApi(d: { id: string; studio_id: string; name: string; object_key: string; drive_file_id: string | null; status: string; error: string | null; created_at: string; batch_id: string | null; audiobook_id: string | null; production_file_id?: string | null }) {
  return { id: d.id, studioId: d.studio_id, name: d.name, status: d.status as 'pending' | 'uploading' | 'completed' | 'failed' | 'pushed', driveFileId: d.drive_file_id, error: d.error, createdAt: d.created_at, batchId: d.batch_id, audiobookId: d.audiobook_id, productionFileId: d.production_file_id ?? null };
}

studioPortal.get('/:slug', async (c) => {
  const slug = c.req.param('slug');
  const session = await requireStudioSession(c, slug);
  if (!session) return c.json({ error: 'Unauthorized' }, 401);
  const repo = new Repository(c.env.DB);
  const studio = await repo.getStudioBySlug(slug);
  if (!studio || !studio.is_active) return c.json({ error: 'Not found' }, 404);
  // Log a "viewed portal" event, throttled to once per 5 min per user to avoid
  // flooding the audit trail on refetches/navigation.
  if (!(await repo.recentAuditExists('studio', studio.id, 'studio.viewed', session.email || 'studio', 5 * 60 * 1000))) {
    await repo.audit('studio', studio.id, 'studio.viewed', session.email || 'studio', {}).catch(() => undefined);
  }
  await repo.failStalePendingDeliveries().catch(() => undefined);
  const [assets, sharedAssets, productionFiles, samples, driveUploads] = await Promise.all([
    repo.listStudioAssets(studio.id),
    repo.listSharedAssetsForStudio(studio.id),
    repo.listStudioProductionFiles(studio.id),
    repo.listStudioSamples(studio.id),
    repo.listDriveUploads(studio.id),
  ]);
  // Build book name lookup from production files
  const bookNameMap = new Map<string, string>();
  for (const f of productionFiles) {
    bookNameMap.set(f.id, f.name);
  }
  // Resolve assigned catalog titles so the studio can target a delivery at one.
  const assignedIds = [...new Set(productionFiles.map((f) => f.audiobook_id).filter((x): x is string => !!x))];
  const titleById = new Map<string, string>();
  await Promise.all(assignedIds.map(async (aid) => {
    const book = await repo.getAudiobook(aid);
    if (book) titleById.set(aid, book.title);
  }));
  const approvedFileIds = new Set(samples.filter((s) => s.status === 'approved' && s.book_id).map((s) => s.book_id!));
  return c.json({
    studio: { id: studio.id, name: studio.name, slug: studio.slug, contactEmail: studio.contact_email, logoObjectKey: studio.logo_object_key, isActive: !!studio.is_active, createdAt: studio.created_at, createdBy: studio.created_by, hourlyRateUsd: studio.hourly_rate_usd },
    assets: [
      ...assets.map((a) => ({ id: a.id, studioId: a.studio_id, name: a.name, objectKey: a.object_key, contentType: a.content_type, sizeBytes: a.size_bytes, uploadedBy: a.uploaded_by, createdAt: a.created_at, shared: false })),
      ...sharedAssets.map((a) => ({ id: a.id, studioId: studio.id, name: a.name, objectKey: a.object_key, contentType: a.content_type, sizeBytes: a.size_bytes, uploadedBy: a.uploaded_by, createdAt: a.created_at, shared: true })),
    ],
    productionFiles: productionFiles.map((f) => ({ id: f.id, studioId: f.studio_id, name: f.name, objectKey: f.object_key, contentType: f.content_type, sizeBytes: f.size_bytes, uploadedBy: f.uploaded_by, createdAt: f.created_at, audiobookId: f.audiobook_id, audiobookTitle: f.audiobook_id ? (titleById.get(f.audiobook_id) ?? null) : null, narrator: f.narrator, expectedNetHours: f.expected_net_hours, estimatedFinishHours: f.estimated_finish_hours, productionStatus: (f.production_status ?? 'backlog'), acqMetadata: f.acq_metadata ? safeJson(f.acq_metadata) : null, hasApprovedSample: approvedFileIds.has(f.id) })),
    samples: samples.map((s) => ({ id: s.id, studioId: s.studio_id, bookId: s.book_id ?? null, bookName: s.book_id ? (bookNameMap.get(s.book_id) ?? null) : null, name: s.name, objectKey: s.object_key, contentType: s.content_type, sizeBytes: s.size_bytes, status: s.status, reviewedBy: s.reviewed_by, reviewNote: s.review_note, reviewedAt: s.reviewed_at, createdAt: s.created_at })),
    driveUploads: driveUploads.map(driveUploadToApi),
    // Titles this studio may deliver finished audio for (assigned by an operator).
    assignedTitles: assignedIds.map((aid) => ({ audiobookId: aid, title: titleById.get(aid) ?? aid })).filter((t) => titleById.has(t.audiobookId)),
  });
});

studioPortal.post('/:slug/asset-download-url', async (c) => {
  const slug = c.req.param('slug');
  const session = await requireStudioSession(c, slug);
  if (!session) return c.json({ error: 'Unauthorized' }, 401);
  const { objectKey } = z.object({ objectKey: z.string() }).parse(await c.req.json());
  const repo = new Repository(c.env.DB);
  const studio = await repo.getStudioBySlug(slug);
  const expiresAt = Date.now() + 60 * 60 * 1000;
  const baseUrl = c.env.APP_BASE_URL ?? `https://${new URL(c.req.url).host}`;
  const url = await signInternalArtifactUrl({ baseUrl, path: `/api/files/${objectKey}`, key: objectKey, method: 'GET', secret: c.env.INTERNAL_API_SECRET, expiresAt });
  if (studio) await repo.audit('studio', studio.id, 'asset.downloaded', session.email || 'studio', { objectKey: objectKey.split('/').pop() }).catch(() => undefined);
  return c.json({ url });
});

studioPortal.post('/:slug/production-file-download-url', async (c) => {
  const slug = c.req.param('slug');
  const session = await requireStudioSession(c, slug);
  if (!session) return c.json({ error: 'Unauthorized' }, 401);
  const { objectKey } = z.object({ objectKey: z.string() }).parse(await c.req.json());
  const repo = new Repository(c.env.DB);
  const studio = await repo.getStudioBySlug(slug);
  const expiresAt = Date.now() + 60 * 60 * 1000;
  const baseUrl = c.env.APP_BASE_URL ?? `https://${new URL(c.req.url).host}`;
  const url = await signInternalArtifactUrl({ baseUrl, path: `/api/files/${objectKey}`, key: objectKey, method: 'GET', secret: c.env.INTERNAL_API_SECRET, expiresAt });
  if (studio) await repo.audit('studio', studio.id, 'production_file.downloaded', session.email || 'studio', { objectKey: objectKey.split('/').pop() }).catch(() => undefined);
  return c.json({ url });
});

studioPortal.post('/:slug/drive-upload-url', async (c) => {
  const slug = c.req.param('slug');
  const session = await requireStudioSession(c, slug);
  if (!session) return c.json({ error: 'Unauthorized' }, 401);
  const { fileName, contentType, sizeBytes, audiobookId, netFinalHours, notes, productionFileId } = z.object({
    fileName: z.string(), contentType: z.string(), sizeBytes: z.number().optional(),
    audiobookId: z.string().nullable().optional(),
    netFinalHours: z.number().nonnegative().nullable().optional(),
    notes: z.string().nullable().optional(),
    productionFileId: z.string().nullable().optional(),
  }).parse(await c.req.json());
  const repo = new Repository(c.env.DB);
  const studio = await repo.getStudioBySlug(slug);
  if (!studio) return c.json({ error: 'Not found' }, 404);
  // If targeting a title, it must be one assigned to this studio.
  if (audiobookId) {
    const assigned = await repo.listStudioProductionFiles(studio.id);
    if (!assigned.some((f) => f.audiobook_id === audiobookId)) {
      return c.json({ error: 'That title is not assigned to your studio.' }, 403);
    }
  }
  if (productionFileId) {
    const pf = await repo.getStudioProductionFile(productionFileId);
    if (!pf || pf.studio_id !== studio.id) return c.json({ error: 'That book is not part of your studio.' }, 403);
  }
  const key = keySegments('studios', studio.id, 'deliveries', `${Date.now()}-${safeStorageName(fileName)}`);
  const upload = await createUploadUrl(c.env, key, contentType);
  const uploadId = await repo.createDriveUpload({ studioId: studio.id, name: fileName, objectKey: key, audiobookId: audiobookId ?? null, netFinalHours: netFinalHours ?? null, notes: notes ?? null, productionFileId: productionFileId ?? null });
  return c.json({ ...upload, objectKey: key, uploadId });
});

// Start a resumable multipart delivery for large files (chunks stream through
// the worker, avoiding the single-PUT / worker memory limits).
studioPortal.post('/:slug/delivery-multipart-start', async (c) => {
  const slug = c.req.param('slug');
  const session = await requireStudioSession(c, slug);
  if (!session) return c.json({ error: 'Unauthorized' }, 401);
  const { fileName, contentType, audiobookId, netFinalHours, notes, productionFileId } = z.object({
    fileName: z.string(), contentType: z.string(),
    audiobookId: z.string().nullable().optional(),
    netFinalHours: z.number().nonnegative().nullable().optional(),
    notes: z.string().nullable().optional(),
    productionFileId: z.string().nullable().optional(),
  }).parse(await c.req.json());
  const repo = new Repository(c.env.DB);
  const studio = await repo.getStudioBySlug(slug);
  if (!studio) return c.json({ error: 'Not found' }, 404);
  if (audiobookId) {
    const assigned = await repo.listStudioProductionFiles(studio.id);
    if (!assigned.some((f) => f.audiobook_id === audiobookId)) {
      return c.json({ error: 'That title is not assigned to your studio.' }, 403);
    }
  }
  if (productionFileId) {
    const pf = await repo.getStudioProductionFile(productionFileId);
    if (!pf || pf.studio_id !== studio.id) return c.json({ error: 'That book is not part of your studio.' }, 403);
  }
  const key = keySegments('studios', studio.id, 'deliveries', `${Date.now()}-${safeStorageName(fileName)}`);
  const uploadId = await repo.createDriveUpload({ studioId: studio.id, name: fileName, objectKey: key, audiobookId: audiobookId ?? null, netFinalHours: netFinalHours ?? null, notes: notes ?? null, productionFileId: productionFileId ?? null });
  const baseUrl = c.env.APP_BASE_URL ?? `https://${new URL(c.req.url).host}`;
  const multipartStartUrl = await signMultipartUrl({
    baseUrl, path: '/api/internal/multipart-start', key, method: 'POST',
    secret: c.env.INTERNAL_API_SECRET, expiresAt: Date.now() + 6 * 60 * 60 * 1000,
  });
  return c.json({ uploadId, objectKey: key, multipartStartUrl, contentType });
});

// Studio submits the production plan for an assigned file (after sample approval).
studioPortal.post('/:slug/production-files/:fileId/plan', async (c) => {
  const slug = c.req.param('slug');
  const session = await requireStudioSession(c, slug);
  if (!session) return c.json({ error: 'Unauthorized' }, 401);
  const { narrator, expectedNetHours, estimatedFinishHours } = z.object({
    narrator: z.string().nullable().optional(),
    expectedNetHours: z.number().nonnegative().nullable().optional(),
    estimatedFinishHours: z.number().nonnegative().nullable().optional(),
  }).parse(await c.req.json());
  const repo = new Repository(c.env.DB);
  const file = await repo.getStudioProductionFile(c.req.param('fileId')!);
  if (!file || file.studio_id !== session.studioId) return c.json({ error: 'Not found' }, 404);
  const samples = await repo.listStudioSamples(session.studioId);
  const approved = samples.some((s) => s.book_id === file.id && s.status === 'approved');
  if (!approved) return c.json({ error: 'A sample must be approved before submitting the production plan.' }, 400);
  await repo.setStudioProductionFilePlan(file.id, {
    narrator: narrator ?? null,
    expectedNetHours: expectedNetHours ?? null,
    estimatedFinishHours: estimatedFinishHours ?? null,
  });
  await repo.audit('studio', file.studio_id, 'production_file.plan_submitted', session.email || 'studio', { productionFileId: file.id, name: file.name, narrator, expectedNetHours }).catch(() => undefined);
  return c.json({ ok: true });
});

// Studio moves a book between Backlog and In Production. "Delivered" is set only
// by uploading a delivery from the book row (handled on delivery completion).
studioPortal.post('/:slug/production-files/:fileId/status', async (c) => {
  const slug = c.req.param('slug');
  const session = await requireStudioSession(c, slug);
  if (!session) return c.json({ error: 'Unauthorized' }, 401);
  const { status } = z.object({ status: z.enum(['backlog', 'in_production']) }).parse(await c.req.json());
  const repo = new Repository(c.env.DB);
  const file = await repo.getStudioProductionFile(c.req.param('fileId')!);
  if (!file || file.studio_id !== session.studioId) return c.json({ error: 'Not found' }, 404);
  if (file.production_status === 'delivered') {
    return c.json({ error: 'This book is already delivered.' }, 400);
  }
  await repo.setStudioProductionFileStatus(file.id, status);
  await repo.audit('studio', file.studio_id, 'production_file.status_changed', session.email || 'studio', { productionFileId: file.id, name: file.name, status }).catch(() => undefined);
  return c.json({ ok: true });
});

studioPortal.post('/:slug/drive-uploads/:uploadId/complete', async (c) => {
  const slug = c.req.param('slug');
  const session = await requireStudioSession(c, slug);
  if (!session) return c.json({ error: 'Unauthorized' }, 401);
  const uploadId = c.req.param('uploadId');
  const repo = new Repository(c.env.DB);
  const upload = await repo.getDriveUpload(uploadId);
  if (!upload || upload.studio_id !== session.studioId) return c.json({ error: 'Not found' }, 404);
  const studio = await repo.getStudioBySlug(slug);
  if (!studio) return c.json({ error: 'Not found' }, 404);

  const object = await c.env.ASSET_BUCKET.head(upload.object_key);
  if (!object) {
    await repo.updateDriveUpload(uploadId, { status: 'failed', error: 'Uploaded object not found in storage.' });
    return c.json({ error: 'Uploaded object not found in storage.' }, 404);
  }

  // Just record the delivery — an operator decides whether to push it into the
  // audiobooks system (or delete it) from the studio management page.
  await repo.updateDriveUpload(uploadId, { status: 'completed' });
  // A delivery uploaded from a book row marks that book "delivered".
  if (upload.production_file_id) {
    const pf = await repo.getStudioProductionFile(upload.production_file_id);
    if (pf && pf.studio_id === studio.id) await repo.setStudioProductionFileStatus(pf.id, 'delivered');
  }
  await repo.audit('studio', studio.id, 'delivery.uploaded', session.email || 'studio', { uploadId, name: upload.name, audiobookId: upload.audiobook_id, productionFileId: upload.production_file_id, netFinalHours: upload.net_final_hours });

  const baseUrl = c.env.APP_BASE_URL ?? `https://audiobooks.samawy-ops.com`;
  const operators = (await repo.listOperatorUsers()).filter((op) => op.isActive);
  await Promise.allSettled(operators.map((op) =>
    sendEmail({
      to: op.email,
      subject: `تسليم جديد من ${studio.name}`,
      html: notifyEmail({
        eyebrow: 'إشعار للمشغّلين', heading: `تسليم جديد من ${studio.name}`,
        body: `رفع استوديو ${studio.name} ملفاً بعنوان "<strong>${upload.name}</strong>". راجِعه ثم ادفعه إلى النظام من صفحة إدارة الاستوديو.`,
        ctaLabel: 'مراجعة التسليم', link: `${baseUrl}/studios/${studio.id}`,
        info: { type: 'ZIP', name: upload.name, meta: studio.name },
      }),
      emailBinding: c.env.EMAIL,
    }),
  ));
  return c.json({ ok: true });
});

// A studio deletes its own delivery (mistaken / incomplete upload). Not allowed
// once an operator has pushed it into the system.
studioPortal.delete('/:slug/drive-uploads/:uploadId', async (c) => {
  const slug = c.req.param('slug');
  const session = await requireStudioSession(c, slug);
  if (!session) return c.json({ error: 'Unauthorized' }, 401);
  const repo = new Repository(c.env.DB);
  const upload = await repo.getDriveUpload(c.req.param('uploadId'));
  if (!upload || upload.studio_id !== session.studioId) return c.json({ error: 'Not found' }, 404);
  if (upload.status === 'pushed') return c.json({ error: 'This delivery is already in production and cannot be deleted.' }, 400);
  if (upload.object_key) await c.env.ASSET_BUCKET.delete(upload.object_key).catch(() => undefined);
  await repo.deleteDriveUpload(upload.id);
  await repo.audit('studio', session.studioId, 'delivery.deleted', session.email || 'studio', { uploadId: upload.id, name: upload.name }).catch(() => undefined);
  return c.json({ ok: true });
});

studioPortal.post('/:slug/sample-upload-url', async (c) => {
  const slug = c.req.param('slug');
  const session = await requireStudioSession(c, slug);
  if (!session) return c.json({ error: 'Unauthorized' }, 401);
  const { fileName, contentType, sizeBytes, bookId } = z.object({ fileName: z.string(), contentType: z.string(), sizeBytes: z.number().optional(), bookId: z.string().optional() }).parse(await c.req.json());
  const repo = new Repository(c.env.DB);
  const studio = await repo.getStudioBySlug(slug);
  if (!studio) return c.json({ error: 'Not found' }, 404);
  const key = keySegments('studios', studio.id, 'samples', `${Date.now()}-${safeStorageName(fileName)}`);
  const upload = await createUploadUrl(c.env, key, contentType);
  const sampleId = await repo.createStudioSample({ studioId: studio.id, bookId: bookId ?? null, name: fileName, objectKey: key, contentType, sizeBytes: sizeBytes ?? 0 });
  await repo.audit('studio', studio.id, 'sample.uploaded', session.email || 'studio', { sampleId, name: fileName, bookId: bookId ?? null }).catch(() => undefined);
  // Notify operators
  const operators = await repo.listOperatorUsers();
  const baseUrl = c.env.APP_BASE_URL ?? `https://${new URL(c.req.url).host}`;
  await Promise.allSettled(operators.filter((op) => op.isActive).map((op) =>
    sendEmail({
      to: op.email,
      subject: `عينة جديدة من ${studio.name}`,
      html: notifyEmail({
        eyebrow: 'إشعار للمشغّلين', heading: `عينة جديدة: ${fileName}`,
        body: `رفع استوديو ${studio.name} عينة جديدة بعنوان "<strong>${fileName}</strong>" تنتظر مراجعتك.`,
        ctaLabel: 'مراجعة العينات', link: `${baseUrl}/studios/${studio.id}`,
        info: { type: 'MP3', name: fileName, meta: studio.name },
      }),
      emailBinding: c.env.EMAIL,
    })
  ));
  return c.json({ ...upload, objectKey: key, sampleId });
});

export default studioPortal;

import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../types';
import { Repository } from '../db';
import { requirePermission, actorEmail } from './auth';
import { createUploadUrl } from '../pipeline';
import { sendEmail, magicLinkEmail, notifyOperatorsEmail, sampleReviewedEmail } from '../email';
import { keySegments, nowIso, signInternalArtifactUrl } from '../utils';

const studios = new Hono<{ Bindings: Env }>();

function studioToApi(s: { id: string; name: string; slug: string; contact_email: string; logo_object_key: string | null; is_active: number; created_at: string; created_by: string; hourly_rate_usd: number | null }) {
  return { id: s.id, name: s.name, slug: s.slug, contactEmail: s.contact_email, logoObjectKey: s.logo_object_key, isActive: !!s.is_active, createdAt: s.created_at, createdBy: s.created_by, hourlyRateUsd: s.hourly_rate_usd };
}

function contactToApi(c: { id: string; studio_id: string; email: string; name: string | null; created_at: string }) {
  return { id: c.id, studioId: c.studio_id, email: c.email, name: c.name, createdAt: c.created_at };
}

function assetToApi(a: { id: string; studio_id: string; name: string; object_key: string; content_type: string; size_bytes: number; uploaded_by: string; created_at: string }) {
  return { id: a.id, studioId: a.studio_id, name: a.name, objectKey: a.object_key, contentType: a.content_type, sizeBytes: a.size_bytes, uploadedBy: a.uploaded_by, createdAt: a.created_at };
}

function productionFileToApi(
  f: { id: string; studio_id: string; name: string; object_key: string; content_type: string; size_bytes: number; uploaded_by: string; created_at: string; audiobook_id: string | null; narrator: string | null; expected_net_hours: number | null; estimated_finish_hours: number | null },
  audiobookTitle: string | null = null,
  hasApprovedSample = false,
) {
  return {
    id: f.id, studioId: f.studio_id, name: f.name, objectKey: f.object_key,
    contentType: f.content_type, sizeBytes: f.size_bytes, uploadedBy: f.uploaded_by, createdAt: f.created_at,
    audiobookId: f.audiobook_id, audiobookTitle,
    narrator: f.narrator, expectedNetHours: f.expected_net_hours, estimatedFinishHours: f.estimated_finish_hours,
    hasApprovedSample,
  };
}

function driveUploadToApi(d: { id: string; studio_id: string; name: string; drive_file_id: string | null; status: string; error: string | null; created_at: string; batch_id: string | null; audiobook_id: string | null; net_final_hours: number | null; notes: string | null }) {
  return { id: d.id, studioId: d.studio_id, name: d.name, status: d.status as 'pending' | 'uploading' | 'completed' | 'failed' | 'pushed', driveFileId: d.drive_file_id, error: d.error, createdAt: d.created_at, batchId: d.batch_id, audiobookId: d.audiobook_id, netFinalHours: d.net_final_hours, notes: d.notes };
}

function sampleToApi(s: { id: string; studio_id: string; book_id?: string | null; name: string; object_key: string; content_type: string; size_bytes: number; status: string; reviewed_by: string | null; review_note: string | null; reviewed_at: string | null; created_at: string }, bookName: string | null = null) {
  return { id: s.id, studioId: s.studio_id, bookId: s.book_id ?? null, bookName, name: s.name, objectKey: s.object_key, contentType: s.content_type, sizeBytes: s.size_bytes, status: s.status as 'pending' | 'approved' | 'refused', reviewedBy: s.reviewed_by, reviewNote: s.review_note, reviewedAt: s.reviewed_at, createdAt: s.created_at };
}

// ─── Studios CRUD ─────────────────────────────────────────────────────────────

studios.get('/', requirePermission('users'), async (c) => {
  const repo = new Repository(c.env.DB);
  const [list, agg] = await Promise.all([repo.listStudios(), repo.getStudioAggregates()]);
  const empty = { contacts: 0, productionFiles: 0, assignedFiles: 0, samplesTotal: 0, samplesPending: 0, samplesApproved: 0, samplesRefused: 0, deliveries: 0, deliveriesCompleted: 0, netFinalHours: 0, legacyProductions: 0, legacyNetHours: 0 };
  const studiosWithStats = list.map((s) => {
    const a = agg.get(s.id) ?? empty;
    const rate = s.hourly_rate_usd;
    const totalNetHours = a.netFinalHours + a.legacyNetHours;
    const cost = rate != null ? rate * totalNetHours : null;
    return { ...studioToApi(s), stats: { ...a, netFinalHours: totalNetHours, costUsd: cost } };
  });
  const summary = {
    totalStudios: list.length,
    activeStudios: list.filter((s) => s.is_active).length,
    totalUsers: studiosWithStats.reduce((n, s) => n + s.stats.contacts, 0),
    totalProductionFiles: studiosWithStats.reduce((n, s) => n + s.stats.productionFiles, 0),
    totalAssigned: studiosWithStats.reduce((n, s) => n + s.stats.assignedFiles, 0),
    samplesPending: studiosWithStats.reduce((n, s) => n + s.stats.samplesPending, 0),
    samplesApproved: studiosWithStats.reduce((n, s) => n + s.stats.samplesApproved, 0),
    samplesRefused: studiosWithStats.reduce((n, s) => n + s.stats.samplesRefused, 0),
    totalDeliveries: studiosWithStats.reduce((n, s) => n + s.stats.deliveries, 0),
    totalLegacyProductions: studiosWithStats.reduce((n, s) => n + s.stats.legacyProductions, 0),
    totalNetHours: studiosWithStats.reduce((n, s) => n + s.stats.netFinalHours, 0),
    totalCostUsd: studiosWithStats.reduce((n, s) => n + (s.stats.costUsd ?? 0), 0),
  };
  return c.json({ studios: studiosWithStats, summary });
});

// ─── Legacy full import ───────────────────────────────────────────────────────
// One-time import of pre-existing studios with their users, rate, and the books
// they already produced (net hours → billing history). Idempotent by slug.
const legacyStudioSchema = z.object({
  // When studioId is set, productions attach to that existing studio.
  studioId: z.string().optional(),
  name: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9-]+$/).optional(),
  contactEmail: z.string().email().optional(),
  emails: z.array(z.string().email()).optional(),
  hourlyRateUsd: z.number().nonnegative().nullable().optional(),
  active: z.boolean().optional(),
  productions: z.array(z.object({
    bookTitle: z.string().min(1),
    isbn: z.string().nullish(),
    narrator: z.string().nullish(),
    netHours: z.number().nonnegative().nullish(),
    notes: z.string().nullish(),
  })).optional(),
});

studios.post('/legacy-import', requirePermission('users'), async (c) => {
  const body = z.object({ studios: z.array(legacyStudioSchema).min(1).max(2000) }).parse(await c.req.json());
  const repo = new Repository(c.env.DB);
  let studiosCreated = 0, studiosUpdated = 0, productionsCreated = 0;
  for (const row of body.studios) {
    let studio = row.studioId ? await repo.getStudio(row.studioId) : null;
    if (row.studioId) {
      // Attaching to an existing studio.
      if (!studio) continue;
      studiosUpdated += 1;
    } else {
      const slug = (row.slug ?? row.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')).slice(0, 80) || `studio-${crypto.randomUUID().slice(0, 8)}`;
      studio = await repo.getStudioBySlug(slug);
      if (!studio) {
        if (!row.contactEmail) continue; // new studios need a contact email
        await repo.createStudio({ id: crypto.randomUUID(), name: row.name, slug, contactEmail: row.contactEmail, createdBy: actorEmail(c.req.raw) });
        studio = await repo.getStudioBySlug(slug);
        studiosCreated += 1;
      } else {
        studiosUpdated += 1;
      }
    }
    if (!studio) continue;
    // Rate / active updates
    const patch: Partial<{ hourlyRateUsd: number | null; isActive: number }> = {};
    if ('hourlyRateUsd' in row) patch.hourlyRateUsd = row.hourlyRateUsd ?? null;
    if (row.active !== undefined) patch.isActive = row.active ? 1 : 0;
    if (Object.keys(patch).length) await repo.updateStudio(studio.id, patch);
    // Contacts (primary + extras)
    if (row.contactEmail) await repo.addStudioContact(studio.id, row.contactEmail).catch(() => undefined);
    for (const e of row.emails ?? []) await repo.addStudioContact(studio.id, e).catch(() => undefined);
    // Legacy productions
    for (const p of row.productions ?? []) {
      await repo.createLegacyProduction({ studioId: studio.id, bookTitle: p.bookTitle, isbn: p.isbn ?? null, narrator: p.narrator ?? null, netHours: p.netHours ?? null, notes: p.notes ?? null });
      productionsCreated += 1;
    }
    await repo.audit('studio', studio.id, 'legacy.imported', actorEmail(c.req.raw), { productions: row.productions?.length ?? 0 });
  }
  return c.json({ ok: true, studiosCreated, studiosUpdated, productionsCreated });
});

// Edit / delete an imported legacy production
studios.patch('/:id/legacy-productions/:prodId', requirePermission('users'), async (c) => {
  const body = z.object({
    bookTitle: z.string().min(1).optional(),
    isbn: z.string().nullable().optional(),
    narrator: z.string().nullable().optional(),
    netHours: z.number().nonnegative().nullable().optional(),
    notes: z.string().nullable().optional(),
  }).parse(await c.req.json());
  const repo = new Repository(c.env.DB);
  await repo.updateLegacyProduction(c.req.param('id')!, c.req.param('prodId')!, body);
  return c.json({ ok: true });
});

studios.delete('/:id/legacy-productions/:prodId', requirePermission('users'), async (c) => {
  const repo = new Repository(c.env.DB);
  await repo.deleteLegacyProduction(c.req.param('id')!, c.req.param('prodId')!);
  return c.json({ ok: true });
});

studios.get('/:id', requirePermission('users'), async (c) => {
  const repo = new Repository(c.env.DB);
  const studio = await repo.getStudio(c.req.param('id')!);
  if (!studio) return c.json({ error: 'Not found' }, 404);
  const [assets, productionFiles, samples, driveUploads, contacts, legacyProductions] = await Promise.all([
    repo.listStudioAssets(studio.id),
    repo.listStudioProductionFiles(studio.id),
    repo.listStudioSamples(studio.id),
    repo.listDriveUploads(studio.id),
    repo.listStudioContacts(studio.id),
    repo.listLegacyProductions(studio.id),
  ]);
  // Resolve assigned catalog titles for production files (one lookup per distinct id).
  const assignedIds = [...new Set(productionFiles.map((f) => f.audiobook_id).filter((id): id is string => !!id))];
  const titleById = new Map<string, string>();
  await Promise.all(assignedIds.map(async (id) => {
    const book = await repo.getAudiobook(id);
    if (book) titleById.set(id, book.title);
  }));
  const approvedFileIds = new Set(samples.filter((s) => s.status === 'approved' && s.book_id).map((s) => s.book_id!));
  const fileNameById = new Map(productionFiles.map((f) => [f.id, f.name]));
  return c.json({
    studio: studioToApi(studio),
    contacts: contacts.map(contactToApi),
    assets: assets.map(assetToApi),
    productionFiles: productionFiles.map((f) => productionFileToApi(f, f.audiobook_id ? titleById.get(f.audiobook_id) ?? null : null, approvedFileIds.has(f.id))),
    samples: samples.map((s) => sampleToApi(s, s.book_id ? fileNameById.get(s.book_id) ?? null : null)),
    driveUploads: driveUploads.map(driveUploadToApi),
    legacyProductions: legacyProductions.map((p) => ({ id: p.id, studioId: p.studio_id, bookTitle: p.book_title, isbn: p.isbn, narrator: p.narrator, netHours: p.net_hours, notes: p.notes, createdAt: p.created_at })),
  });
});

// ─── Deliveries (operator review) ─────────────────────────────────────────────

// Push a delivered file into the audiobooks system: attach to its assigned title
// (skips intake) or create an upload-type intake batch for an unassigned file.
studios.post('/:id/deliveries/:uploadId/push', requirePermission('intake'), async (c) => {
  const studioId = c.req.param('id')!;
  const uploadId = c.req.param('uploadId')!;
  const repo = new Repository(c.env.DB);
  const studio = await repo.getStudio(studioId);
  const upload = await repo.getDriveUpload(uploadId);
  if (!studio || !upload || upload.studio_id !== studioId) return c.json({ error: 'Delivery not found' }, 404);
  if (upload.status !== 'completed') return c.json({ error: 'Only completed deliveries can be pushed.' }, 400);
  if (upload.batch_id) return c.json({ error: 'This delivery was already pushed.' }, 400);
  const object = await c.env.ASSET_BUCKET.head(upload.object_key);
  if (!object) return c.json({ error: 'Delivered file is no longer in storage.' }, 404);

  // Assigned → attach to the catalog title and reset it to pending.
  if (upload.audiobook_id) {
    const book = await repo.getAudiobook(upload.audiobook_id);
    const candidate = book?.candidateId ? await repo.getCandidate(book.candidateId) : null;
    if (!book || !candidate) return c.json({ error: 'Assigned title is no longer available.' }, 409);
    const fileName = upload.object_key.split('/').pop() ?? upload.name;
    const newSourceGroup = {
      ...(candidate.sourceGroup ?? {}),
      items: [{ key: upload.object_key, name: fileName, mimeType: object.httpMetadata?.contentType ?? 'application/octet-stream', sizeBytes: object.size, parentPath: '' }],
      coverCandidates: candidate.sourceGroup?.coverCandidates ?? [],
    };
    await repo.updateCandidateSourceGroup(candidate.id, newSourceGroup.groupKey ?? null, newSourceGroup as Parameters<typeof repo.updateCandidateSourceGroup>[2]);
    await repo.replaceTracks(book.id, []);
    await repo.updateAudiobook(book.id, {
      processingStatus: 'pending', dossierStatus: 'pending',
      dossierWorkbookKey: null, dossierAudioZipKey: null,
      sampleTrackId: null, sampleStartSeconds: null, sampleEndSeconds: null, sampleObjectKey: null, sampleGeneratedAt: null,
    });
    await repo.updateDriveUpload(uploadId, { status: 'pushed' });
    await repo.audit('audiobook_record', book.id, 'delivery.pushed', actorEmail(c.req.raw), { studioId, uploadId });
    return c.json({ ok: true, mode: 'assigned', audiobookId: book.id });
  }

  // Unassigned → create an upload-type intake batch for operator metadata.
  const batch = await repo.createBatch({ id: crypto.randomUUID(), sourceType: 'upload', uploadObjectKey: upload.object_key, studioId });
  if (!batch) return c.json({ error: 'Failed to create intake batch.' }, 500);
  await repo.linkDriveUploadsToBatch([uploadId], batch.id);
  await repo.updateDriveUpload(uploadId, { status: 'pushed' });
  await repo.audit('ingestion_batch', batch.id, 'created', actorEmail(c.req.raw), { source: 'studio_delivery_pushed', studioId, uploadId });
  return c.json({ ok: true, mode: 'unassigned', batchId: batch.id });
});

studios.delete('/:id/deliveries/:uploadId', requirePermission('users'), async (c) => {
  const studioId = c.req.param('id')!;
  const uploadId = c.req.param('uploadId')!;
  const repo = new Repository(c.env.DB);
  const upload = await repo.getDriveUpload(uploadId);
  if (!upload || upload.studio_id !== studioId) return c.json({ error: 'Delivery not found' }, 404);
  if (upload.object_key) await c.env.ASSET_BUCKET.delete(upload.object_key).catch(() => undefined);
  await repo.deleteDriveUpload(uploadId);
  await repo.audit('studio', studioId, 'delivery.deleted', actorEmail(c.req.raw), { uploadId });
  return c.json({ ok: true });
});

// ─── Studio contacts (login users) ────────────────────────────────────────────
studios.post('/:id/contacts', requirePermission('users'), async (c) => {
  const { email, name } = z.object({ email: z.string().email(), name: z.string().optional() }).parse(await c.req.json());
  const repo = new Repository(c.env.DB);
  const studio = await repo.getStudio(c.req.param('id')!);
  if (!studio) return c.json({ error: 'Studio not found' }, 404);
  await repo.addStudioContact(studio.id, email, name ?? null);
  const contacts = await repo.listStudioContacts(studio.id);
  return c.json({ ok: true, contacts: contacts.map(contactToApi) });
});

studios.delete('/:id/contacts/:contactId', requirePermission('users'), async (c) => {
  const repo = new Repository(c.env.DB);
  const studioId = c.req.param('id')!;
  const contacts = await repo.listStudioContacts(studioId);
  if (contacts.length <= 1) return c.json({ error: 'A studio must keep at least one contact.' }, 400);
  await repo.deleteStudioContact(studioId, c.req.param('contactId')!);
  const next = await repo.listStudioContacts(studioId);
  return c.json({ ok: true, contacts: next.map(contactToApi) });
});

studios.post('/', requirePermission('users'), async (c) => {
  const body = z.object({
    name: z.string().min(1),
    slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
    contactEmail: z.string().email(),
  }).parse(await c.req.json());
  const repo = new Repository(c.env.DB);
  const studio = await repo.createStudio({ id: crypto.randomUUID(), name: body.name, slug: body.slug, contactEmail: body.contactEmail, createdBy: actorEmail(c.req.raw) });
  return c.json({ ok: true, studio: studio ? studioToApi(studio) : null }, 201);
});

studios.patch('/:id', requirePermission('users'), async (c) => {
  const body = z.object({
    name: z.string().min(1).optional(),
    slug: z.string().regex(/^[a-z0-9-]+$/).optional(),
    contactEmail: z.string().email().optional(),
    isActive: z.boolean().optional(),
    hourlyRateUsd: z.number().nonnegative().nullable().optional(),
  }).parse(await c.req.json());
  const repo = new Repository(c.env.DB);
  await repo.updateStudio(c.req.param('id')!, {
    name: body.name,
    slug: body.slug,
    contactEmail: body.contactEmail,
    isActive: body.isActive !== undefined ? (body.isActive ? 1 : 0) : undefined,
    ...('hourlyRateUsd' in body ? { hourlyRateUsd: body.hourlyRateUsd ?? null } : {}),
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
  const baseUrl = c.env.APP_BASE_URL ?? `https://audiobooks.samawy-ops.com`;
  const link = `${baseUrl}/api/studio-auth/verify?token=${token}`;

  // Build signed studio logo URL if available
  let studioLogoUrl: string | undefined;
  if (studio.logo_object_key) {
    const logoExpiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
    const logoBaseUrl = c.env.APP_BASE_URL ?? `https://audiobooks.samawy-ops.com`;
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
  const baseUrl = c.env.APP_BASE_URL ?? `https://audiobooks.samawy-ops.com`;
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

// Assign (or clear) the catalog title a production file narrates.
studios.patch('/:id/production-files/:fileId/assign', requirePermission('users'), async (c) => {
  const { audiobookId } = z.object({ audiobookId: z.string().nullable() }).parse(await c.req.json());
  const repo = new Repository(c.env.DB);
  const file = await repo.getStudioProductionFile(c.req.param('fileId')!);
  if (!file || file.studio_id !== c.req.param('id')) return c.json({ error: 'Production file not found' }, 404);
  let audiobookTitle: string | null = null;
  if (audiobookId) {
    const book = await repo.getAudiobook(audiobookId);
    if (!book) return c.json({ error: 'Audiobook not found' }, 404);
    audiobookTitle = book.title;
  }
  await repo.setStudioProductionFileAudiobook(file.id, audiobookId);
  await repo.audit('studio', file.studio_id, audiobookId ? 'production_file.assigned' : 'production_file.unassigned', actorEmail(c.req.raw), {
    productionFileId: file.id,
    audiobookId,
  });
  return c.json({ ok: true, productionFile: productionFileToApi({ ...file, audiobook_id: audiobookId }, audiobookTitle) });
});

// ─── Samples ──────────────────────────────────────────────────────────────────

studios.get('/:id/samples', requirePermission('users'), async (c) => {
  const repo = new Repository(c.env.DB);
  const [samples, files] = await Promise.all([
    repo.listStudioSamples(c.req.param('id')!),
    repo.listStudioProductionFiles(c.req.param('id')!),
  ]);
  const fileNameById = new Map(files.map((f) => [f.id, f.name]));
  return c.json({ samples: samples.map((s) => sampleToApi(s, s.book_id ? fileNameById.get(s.book_id) ?? null : null)) });
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
  const baseUrl = c.env.APP_BASE_URL ?? `https://audiobooks.samawy-ops.com`;
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

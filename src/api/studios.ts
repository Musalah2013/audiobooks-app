import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../types';
import { Repository } from '../db';
import { requirePermission, requireStudiosAccess, actorEmail } from './auth';
import { createUploadUrl } from '../pipeline';
import { sendEmail, notifyEmail, sampleReviewedEmail } from '../email';
import { keySegments, nowIso, buildCatalogStorageBasePath } from '../utils';
import { hashPassword } from '../password';

const studios = new Hono<{ Bindings: Env }>();

function studioToApi(s: { id: string; name: string; slug: string; contact_email: string; logo_object_key: string | null; is_active: number; created_at: string; created_by: string; hourly_rate_usd: number | null }) {
  return { id: s.id, name: s.name, slug: s.slug, contactEmail: s.contact_email, logoObjectKey: s.logo_object_key, isActive: !!s.is_active, createdAt: s.created_at, createdBy: s.created_by, hourlyRateUsd: s.hourly_rate_usd };
}

function contactToApi(c: { id: string; studio_id: string; email: string; name: string | null; created_at: string; password_hash?: string | null }) {
  return { id: c.id, studioId: c.studio_id, email: c.email, name: c.name, createdAt: c.created_at, hasPassword: !!c.password_hash };
}

function assetToApi(a: { id: string; studio_id: string; name: string; object_key: string; content_type: string; size_bytes: number; uploaded_by: string; created_at: string }) {
  return { id: a.id, studioId: a.studio_id, name: a.name, objectKey: a.object_key, contentType: a.content_type, sizeBytes: a.size_bytes, uploadedBy: a.uploaded_by, createdAt: a.created_at };
}

function parseAcqMetadata(raw: string | null | undefined) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function productionFileToApi(
  f: { id: string; studio_id: string; name: string; object_key: string; content_type: string; size_bytes: number; uploaded_by: string; created_at: string; audiobook_id: string | null; narrator: string | null; expected_net_hours: number | null; estimated_finish_hours: number | null; book_author?: string | null; acq_notes?: string | null; production_status?: string; acq_metadata?: string | null },
  audiobookTitle: string | null = null,
  hasApprovedSample = false,
) {
  return {
    id: f.id, studioId: f.studio_id, name: f.name, objectKey: f.object_key,
    contentType: f.content_type, sizeBytes: f.size_bytes, uploadedBy: f.uploaded_by, createdAt: f.created_at,
    audiobookId: f.audiobook_id, audiobookTitle,
    narrator: f.narrator, expectedNetHours: f.expected_net_hours, estimatedFinishHours: f.estimated_finish_hours,
    bookAuthor: f.book_author ?? null, acqNotes: f.acq_notes ?? null,
    acqMetadata: parseAcqMetadata(f.acq_metadata),
    productionStatus: (f.production_status ?? 'backlog') as 'backlog' | 'in_production' | 'delivered',
    hasApprovedSample,
  };
}

function driveUploadToApi(d: { id: string; studio_id: string; name: string; drive_file_id: string | null; status: string; error: string | null; created_at: string; batch_id: string | null; audiobook_id: string | null; net_final_hours: number | null; notes: string | null; production_file_id?: string | null }) {
  return { id: d.id, studioId: d.studio_id, name: d.name, status: d.status as 'pending' | 'uploading' | 'completed' | 'failed' | 'pushed', driveFileId: d.drive_file_id, error: d.error, createdAt: d.created_at, batchId: d.batch_id, audiobookId: d.audiobook_id, netFinalHours: d.net_final_hours, notes: d.notes, productionFileId: d.production_file_id ?? null };
}

function sampleToApi(s: { id: string; studio_id: string; book_id?: string | null; name: string; object_key: string; content_type: string; size_bytes: number; status: string; reviewed_by: string | null; review_note: string | null; reviewed_at: string | null; created_at: string }, bookName: string | null = null) {
  return { id: s.id, studioId: s.studio_id, bookId: s.book_id ?? null, bookName, name: s.name, objectKey: s.object_key, contentType: s.content_type, sizeBytes: s.size_bytes, status: s.status as 'pending' | 'approved' | 'refused', reviewedBy: s.reviewed_by, reviewNote: s.review_note, reviewedAt: s.reviewed_at, createdAt: s.created_at };
}

// ─── Studios CRUD ─────────────────────────────────────────────────────────────

studios.get('/', requireStudiosAccess(), async (c) => {
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

studios.post('/legacy-import', requireStudiosAccess(), async (c) => {
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
studios.patch('/:id/legacy-productions/:prodId', requireStudiosAccess(), async (c) => {
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

studios.delete('/:id/legacy-productions/:prodId', requireStudiosAccess(), async (c) => {
  const repo = new Repository(c.env.DB);
  await repo.deleteLegacyProduction(c.req.param('id')!, c.req.param('prodId')!);
  return c.json({ ok: true });
});

// ─── Acquisition users ────────────────────────────────────────────────────────
// NOTE: these literal `/acquisition-users` paths MUST be registered before the
// `/:id` studio routes below, otherwise Hono matches `/:id` first and treats
// "acquisition-users" as a studio id (shadowing the list/create endpoints).

studios.get('/acquisition-users', requireStudiosAccess(), async (c) => {
  const repo = new Repository(c.env.DB);
  const users = await repo.listAcquisitionUsers();
  return c.json({ users: users.map((u) => ({ id: u.id, email: u.email, name: u.name, isActive: !!u.is_active, createdAt: u.created_at })) });
});

studios.post('/acquisition-users', requireStudiosAccess(), async (c) => {
  const { email, name, password } = z.object({ email: z.string().email(), name: z.string().min(1), password: z.string().min(8).optional() }).parse(await c.req.json());
  const repo = new Repository(c.env.DB);
  const id = await repo.createAcquisitionUser({ email, name, createdBy: actorEmail(c.req.raw), passwordHash: password ? await hashPassword(password) : null });
  return c.json({ ok: true, id }, 201);
});

studios.patch('/acquisition-users/:id', requireStudiosAccess(), async (c) => {
  const { name, isActive } = z.object({ name: z.string().min(1).optional(), isActive: z.boolean().optional() }).parse(await c.req.json());
  const repo = new Repository(c.env.DB);
  await repo.updateAcquisitionUser(c.req.param('id')!, { name, isActive: isActive !== undefined ? (isActive ? 1 : 0) : undefined });
  return c.json({ ok: true });
});

// Admin sets/resets an acquisition member's password.
studios.post('/acquisition-users/:id/set-password', requireStudiosAccess(), async (c) => {
  const { password } = z.object({ password: z.string().min(8) }).parse(await c.req.json());
  const repo = new Repository(c.env.DB);
  const user = await repo.getAcquisitionUser(c.req.param('id')!);
  if (!user) return c.json({ error: 'User not found' }, 404);
  await repo.setAcquisitionUserPassword(user.id, await hashPassword(password));
  return c.json({ ok: true });
});

// ─── Shared asset library ─────────────────────────────────────────────────────
// Literal `/shared-assets` paths MUST be registered before the `/:id` studio
// routes below, or Hono treats "shared-assets" as a studio id.

function sharedAssetToApi(a: { id: string; name: string; object_key: string; content_type: string; size_bytes: number; uploaded_by: string; created_at: string; studioIds?: string[] }) {
  return { id: a.id, name: a.name, objectKey: a.object_key, contentType: a.content_type, sizeBytes: a.size_bytes, uploadedBy: a.uploaded_by, createdAt: a.created_at, studioIds: a.studioIds ?? [] };
}

studios.get('/shared-assets', requireStudiosAccess(), async (c) => {
  const repo = new Repository(c.env.DB);
  const assets = await repo.listSharedAssets();
  return c.json({ assets: assets.map(sharedAssetToApi) });
});

// Presigned URL only — the row is created on /complete (no ghost on abandon).
studios.post('/shared-assets/upload-url', requireStudiosAccess(), async (c) => {
  const { fileName, contentType } = z.object({ fileName: z.string(), contentType: z.string().default('application/octet-stream'), sizeBytes: z.number().optional() }).parse(await c.req.json());
  const key = keySegments('shared-assets', `${Date.now()}-${fileName}`);
  const upload = await createUploadUrl(c.env, key, contentType);
  return c.json({ ...upload, objectKey: key });
});

studios.post('/shared-assets/complete', requireStudiosAccess(), async (c) => {
  const body = z.object({ objectKey: z.string(), fileName: z.string(), contentType: z.string().default('application/octet-stream'), sizeBytes: z.number().optional(), studioIds: z.array(z.string()).default([]) }).parse(await c.req.json());
  const repo = new Repository(c.env.DB);
  const object = await c.env.ASSET_BUCKET.head(body.objectKey);
  if (!object) return c.json({ error: 'Uploaded file not found in storage.' }, 404);
  const id = await repo.createSharedAsset({ name: body.fileName, objectKey: body.objectKey, contentType: body.contentType, sizeBytes: body.sizeBytes ?? object.size, uploadedBy: actorEmail(c.req.raw), studioIds: body.studioIds });
  return c.json({ ok: true, id });
});

studios.patch('/shared-assets/:assetId/visibility', requireStudiosAccess(), async (c) => {
  const { studioIds } = z.object({ studioIds: z.array(z.string()) }).parse(await c.req.json());
  const repo = new Repository(c.env.DB);
  const asset = await repo.getSharedAsset(c.req.param('assetId')!);
  if (!asset) return c.json({ error: 'Asset not found' }, 404);
  await repo.setSharedAssetVisibility(asset.id, studioIds);
  return c.json({ ok: true });
});

studios.delete('/shared-assets/:assetId', requireStudiosAccess(), async (c) => {
  const repo = new Repository(c.env.DB);
  const deleted = await repo.deleteSharedAsset(c.req.param('assetId')!);
  if (deleted?.object_key) await c.env.ASSET_BUCKET.delete(deleted.object_key);
  return c.json({ ok: true });
});

// ─── Studio audit trail ───────────────────────────────────────────────────────
// Every recorded action for a studio: logins, views, uploads, downloads, plan
// submissions, status changes, deliveries, reviews, pushes, etc.
studios.get('/:id/audit', requireStudiosAccess(), async (c) => {
  const repo = new Repository(c.env.DB);
  const events = await repo.listAuditEvents('studio', c.req.param('id')!, 500);
  return c.json({ events: events.map((e) => ({ id: e.id, action: e.action, actor: e.actor, createdAt: e.createdAt, detail: e.detailJson ? (() => { try { return JSON.parse(e.detailJson!); } catch { return null; } })() : null })) });
});

// ─── Studio detail + CRUD ─────────────────────────────────────────────────────

studios.get('/:id', requireStudiosAccess(), async (c) => {
  const repo = new Repository(c.env.DB);
  const studio = await repo.getStudio(c.req.param('id')!);
  if (!studio) return c.json({ error: 'Not found' }, 404);
  await repo.failStalePendingDeliveries().catch(() => undefined);
  const [assets, sharedAssets, productionFiles, samples, driveUploads, contacts, legacyProductions] = await Promise.all([
    repo.listStudioAssets(studio.id),
    repo.listSharedAssetsForStudio(studio.id),
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
    // The primary contact authenticates against the studio row's password.
    contacts: contacts.map((ct) => ct.email.toLowerCase() === studio.contact_email.toLowerCase()
      ? { ...contactToApi(ct), hasPassword: !!studio.password_hash }
      : contactToApi(ct)),
    assets: [
      ...assets.map((a) => ({ ...assetToApi(a), shared: false })),
      // Shared-library assets visible to this studio (read-only here; managed centrally).
      ...sharedAssets.map((a) => ({ id: a.id, studioId: studio.id, name: a.name, objectKey: a.object_key, contentType: a.content_type, sizeBytes: a.size_bytes, uploadedBy: a.uploaded_by, createdAt: a.created_at, shared: true })),
    ],
    productionFiles: productionFiles.map((f) => productionFileToApi(f, f.audiobook_id ? titleById.get(f.audiobook_id) ?? null : null, approvedFileIds.has(f.id))),
    samples: samples.map((s) => sampleToApi(s, s.book_id ? fileNameById.get(s.book_id) ?? null : null)),
    driveUploads: driveUploads.map(driveUploadToApi),
    legacyProductions: legacyProductions.map((p) => ({ id: p.id, studioId: p.studio_id, bookTitle: p.book_title, isbn: p.isbn, narrator: p.narrator, netHours: p.net_hours, notes: p.notes, createdAt: p.created_at })),
  });
});

// ─── Deliveries (operator review) ─────────────────────────────────────────────

// Push a delivered file into the audiobooks system. Assigned deliveries attach
// to their catalog title (metadata inherited). Unassigned deliveries are a
// type-2 (one-ZIP) input with no metadata, so the operator supplies it here —
// we create the catalog record from that metadata, attach the ZIP, and go
// straight to track prep + processing (no Drive discovery, no reconciliation).
const deliveryMetadataSchema = z.object({
  sellerId: z.number(),
  sellerName: z.string().min(1),
  title: z.string().min(1),
  subtitle: z.string().nullish(),
  author: z.string().nullish(),
  narrator: z.string().nullish(),
  isbn: z.string().nullish(),
  genre: z.string().nullish(),
  blurb: z.string().nullish(),
  pubYear: z.string().nullish(),
  sellingType: z.enum(['subscription', 'a_la_carte']).nullish(),
  price: z.number().nullish(),
});

studios.post('/:id/deliveries/:uploadId/push', requirePermission('intake'), async (c) => {
  const studioId = c.req.param('id')!;
  const uploadId = c.req.param('uploadId')!;
  const body = await c.req.json().catch(() => ({}));
  const repo = new Repository(c.env.DB);
  const studio = await repo.getStudio(studioId);
  const upload = await repo.getDriveUpload(uploadId);
  if (!studio || !upload || upload.studio_id !== studioId) return c.json({ error: 'Delivery not found' }, 404);
  if (upload.status !== 'completed') return c.json({ error: 'Only completed deliveries can be pushed.' }, 400);
  const object = await c.env.ASSET_BUCKET.head(upload.object_key);
  if (!object) return c.json({ error: 'Delivered file is no longer in storage.' }, 404);
  const fileName = upload.object_key.split('/').pop() ?? upload.name;
  const sourceItem = { key: upload.object_key, name: fileName, mimeType: object.httpMetadata?.contentType ?? 'application/octet-stream', sizeBytes: object.size, parentPath: '' };

  // ── Assigned → attach to the existing catalog title (metadata inherited). ──
  if (upload.audiobook_id) {
    const book = await repo.getAudiobook(upload.audiobook_id);
    const candidate = book?.candidateId ? await repo.getCandidate(book.candidateId) : null;
    if (!book || !candidate) return c.json({ error: 'Assigned title is no longer available.' }, 409);
    const newSourceGroup = {
      ...(candidate.sourceGroup ?? {}),
      items: [sourceItem],
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
    await repo.audit('studio', studioId, 'delivery.pushed', actorEmail(c.req.raw), { uploadId, audiobookId: book.id, title: book.title }).catch(() => undefined);
    return c.json({ ok: true, mode: 'assigned', audiobookId: book.id });
  }

  // ── Unassigned → operator-supplied metadata creates a new catalog record. ──
  const meta = deliveryMetadataSchema.parse(body.metadata ?? body);
  const isbn = meta.isbn?.trim() || null;
  const batch = await repo.createBatch({ id: crypto.randomUUID(), sourceType: 'upload', uploadObjectKey: upload.object_key, studioId });
  if (!batch) return c.json({ error: 'Failed to create batch.' }, 500);
  await repo.updateBatch(batch.id, { status: 'records_created', sellerId: meta.sellerId, sellerName: meta.sellerName, intakeMode: 'studio_delivery' });

  const candidateId = crypto.randomUUID();
  const sourceGroup = {
    groupKey: 'delivery', displayName: meta.title, inferredTitle: meta.title,
    items: [sourceItem], coverCandidates: [], confidence: 1, reasons: ['studio_delivery'],
  };
  await repo.replaceCandidates(batch.id, [{
    id: candidateId, batchId: batch.id, metadataRowIndex: null,
    title: meta.title, author: meta.author ?? null, subtitle: meta.subtitle ?? null, isbn, narrator: meta.narrator ?? null,
    sourceGroupKey: 'delivery', sourceGroup, samawyCandidates: [],
    classificationDecision: 'approved_new', decisionReason: 'studio_delivery', status: 'reviewed', metadataOverride: null,
  }]);

  const bookId = crypto.randomUUID();
  await repo.createAudiobook({
    id: bookId, batchId: batch.id, candidateId,
    publisherId: meta.sellerId, publisherName: meta.sellerName,
    title: meta.title, subtitle: meta.subtitle ?? null, genre: meta.genre ?? null, blurb: meta.blurb ?? null,
    author: meta.author ?? null, narrator: meta.narrator ?? null, isbn,
    pubYear: meta.pubYear ?? null, sellingType: meta.sellingType ?? null, price: meta.price ?? null,
    trackCount: 0, totalLengthSeconds: 0, totalOriginalSizeBytes: object.size, totalFinalSizeBytes: 0,
    mp3SpecsSummary: {}, sourceDriveLink: null, importancePoints: 0,
    classificationDecision: 'new',
    metadataSnapshot: { ...meta, source: 'studio_delivery' },
    storageBasePath: buildCatalogStorageBasePath({ publisherId: meta.sellerId, publisherName: meta.sellerName, isbn, title: meta.title }),
    coverStatus: 'missing', coverObjectKey: null,
    dossierStatus: 'pending', dossierWorkbookKey: null, dossierAudioZipKey: null,
    clickupTaskId: null, clickupTaskUrl: null, clickupSyncStatus: 'never_synced', clickupSyncError: null, clickupSyncedAt: null,
    sampleTrackId: null, sampleStartSeconds: null, sampleEndSeconds: null, sampleObjectKey: null, sampleGeneratedAt: null,
    storageCleanupStatus: 'pending', storageCleanupError: null,
    processingStatus: 'pending', isLegacy: false,
  });
  await repo.setDriveUploadAudiobook(uploadId, bookId);
  await repo.updateDriveUpload(uploadId, { status: 'pushed' });
  await repo.audit('audiobook_record', bookId, 'delivery.pushed_new', actorEmail(c.req.raw), { studioId, uploadId, batchId: batch.id });
  await repo.audit('studio', studioId, 'delivery.pushed', actorEmail(c.req.raw), { uploadId, audiobookId: bookId, title: meta.title }).catch(() => undefined);
  return c.json({ ok: true, mode: 'created', audiobookId: bookId });
});

// Operator edits the final net hours / notes on a delivery (recomputes cost).
studios.patch('/:id/deliveries/:uploadId', requireStudiosAccess(), async (c) => {
  const { netFinalHours, notes } = z.object({
    netFinalHours: z.number().nonnegative().nullable().optional(),
    notes: z.string().nullable().optional(),
  }).parse(await c.req.json());
  const repo = new Repository(c.env.DB);
  const upload = await repo.getDriveUpload(c.req.param('uploadId')!);
  if (!upload || upload.studio_id !== c.req.param('id')) return c.json({ error: 'Delivery not found' }, 404);
  await repo.setDriveUploadMeta(upload.id, { netFinalHours, notes });
  return c.json({ ok: true });
});

studios.delete('/:id/deliveries/:uploadId', requireStudiosAccess(), async (c) => {
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
studios.post('/:id/contacts', requireStudiosAccess(), async (c) => {
  const { email, name, password } = z.object({ email: z.string().email(), name: z.string().optional(), password: z.string().min(8).optional() }).parse(await c.req.json());
  const repo = new Repository(c.env.DB);
  const studio = await repo.getStudio(c.req.param('id')!);
  if (!studio) return c.json({ error: 'Studio not found' }, 404);
  await repo.addStudioContact(studio.id, email, name ?? null, password ? await hashPassword(password) : null);
  const contacts = await repo.listStudioContacts(studio.id);
  return c.json({ ok: true, contacts: contacts.map(contactToApi) });
});

// Admin sets/resets a studio login user's password. The primary contact's
// password lives on the studio row; additional contacts have their own.
studios.post('/:id/contacts/:contactId/set-password', requireStudiosAccess(), async (c) => {
  const { password } = z.object({ password: z.string().min(8) }).parse(await c.req.json());
  const repo = new Repository(c.env.DB);
  const studio = await repo.getStudio(c.req.param('id')!);
  if (!studio) return c.json({ error: 'Studio not found' }, 404);
  const contact = await repo.getStudioContact(c.req.param('contactId')!);
  if (!contact || contact.studio_id !== studio.id) return c.json({ error: 'Contact not found' }, 404);
  const hash = await hashPassword(password);
  // The primary contact's email is authenticated against the studio row.
  if (contact.email.toLowerCase() === studio.contact_email.toLowerCase()) await repo.setStudioPassword(studio.id, hash);
  else await repo.setStudioContactPassword(contact.id, hash);
  return c.json({ ok: true });
});

studios.delete('/:id/contacts/:contactId', requireStudiosAccess(), async (c) => {
  const repo = new Repository(c.env.DB);
  const studioId = c.req.param('id')!;
  const contacts = await repo.listStudioContacts(studioId);
  if (contacts.length <= 1) return c.json({ error: 'A studio must keep at least one contact.' }, 400);
  await repo.deleteStudioContact(studioId, c.req.param('contactId')!);
  const next = await repo.listStudioContacts(studioId);
  return c.json({ ok: true, contacts: next.map(contactToApi) });
});

studios.post('/', requireStudiosAccess(), async (c) => {
  const body = z.object({
    name: z.string().min(1),
    slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
    contactEmail: z.string().email(),
    password: z.string().min(8).optional(),
  }).parse(await c.req.json());
  const repo = new Repository(c.env.DB);
  const studio = await repo.createStudio({ id: crypto.randomUUID(), name: body.name, slug: body.slug, contactEmail: body.contactEmail, createdBy: actorEmail(c.req.raw), passwordHash: body.password ? await hashPassword(body.password) : null });
  return c.json({ ok: true, studio: studio ? studioToApi(studio) : null }, 201);
});

studios.patch('/:id', requireStudiosAccess(), async (c) => {
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

studios.delete('/:id', requireStudiosAccess(), async (c) => {
  const repo = new Repository(c.env.DB);
  await repo.deleteStudio(c.req.param('id')!);
  return c.json({ ok: true });
});

// ─── Password ─────────────────────────────────────────────────────────────────

// Admin sets/resets the primary contact's login password.
studios.post('/:id/set-password', requireStudiosAccess(), async (c) => {
  const { password } = z.object({ password: z.string().min(8) }).parse(await c.req.json());
  const repo = new Repository(c.env.DB);
  const studio = await repo.getStudio(c.req.param('id')!);
  if (!studio) return c.json({ error: 'Studio not found' }, 404);
  await repo.setStudioPassword(studio.id, await hashPassword(password));
  return c.json({ ok: true });
});

// ─── Logo upload ──────────────────────────────────────────────────────────────

studios.post('/:id/logo-upload-url', requireStudiosAccess(), async (c) => {
  const { contentType } = z.object({ contentType: z.string() }).parse(await c.req.json());
  const id = c.req.param('id')!;
  const key = keySegments('studios', id, 'logo');
  const upload = await createUploadUrl(c.env, key, contentType);
  const repo = new Repository(c.env.DB);
  await repo.updateStudio(id, { logoObjectKey: key });
  return c.json({ ...upload, objectKey: key });
});

// ─── Assets ───────────────────────────────────────────────────────────────────

studios.post('/:id/asset-upload-url', requireStudiosAccess(), async (c) => {
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

studios.get('/:id/assets', requireStudiosAccess(), async (c) => {
  const repo = new Repository(c.env.DB);
  const assets = await repo.listStudioAssets(c.req.param('id')!);
  return c.json({ assets: assets.map(assetToApi) });
});

studios.delete('/:id/assets/:assetId', requireStudiosAccess(), async (c) => {
  const repo = new Repository(c.env.DB);
  const deleted = await repo.deleteStudioAsset(c.req.param('assetId')!);
  if (deleted?.object_key) await c.env.ASSET_BUCKET.delete(deleted.object_key);
  return c.json({ ok: true });
});

// ─── Production files ─────────────────────────────────────────────────────────

// Returns a presigned upload URL only — the DB row is created on /complete so a
// failed/abandoned upload never leaves a ghost production file.
studios.post('/:id/production-file-upload-url', requireStudiosAccess(), async (c) => {
  const { fileName, contentType } = z.object({ fileName: z.string(), contentType: z.string().default('application/pdf'), sizeBytes: z.number().optional() }).parse(await c.req.json());
  const studioId = c.req.param('id')!;
  const repo = new Repository(c.env.DB);
  const studio = await repo.getStudio(studioId);
  if (!studio) return c.json({ error: 'Studio not found' }, 404);
  const key = keySegments('studios', studioId, 'production', `${Date.now()}-${fileName}`);
  const upload = await createUploadUrl(c.env, key, contentType);
  return c.json({ ...upload, objectKey: key });
});

// Create the production-file row after the upload landed, then notify the studio.
studios.post('/:id/production-files/complete', requireStudiosAccess(), async (c) => {
  const body = z.object({ objectKey: z.string(), fileName: z.string(), contentType: z.string().default('application/pdf'), sizeBytes: z.number().optional(), bookAuthor: z.string().nullish(), acqNotes: z.string().nullish() }).parse(await c.req.json());
  const studioId = c.req.param('id')!;
  const repo = new Repository(c.env.DB);
  const studio = await repo.getStudio(studioId);
  if (!studio) return c.json({ error: 'Studio not found' }, 404);
  const object = await c.env.ASSET_BUCKET.head(body.objectKey);
  if (!object) return c.json({ error: 'Uploaded file not found in storage.' }, 404);
  const fileId = await repo.createStudioProductionFile({ studioId, name: body.fileName, objectKey: body.objectKey, contentType: body.contentType, sizeBytes: body.sizeBytes ?? object.size, uploadedBy: actorEmail(c.req.raw), bookAuthor: body.bookAuthor ?? null, acqNotes: body.acqNotes ?? null });
  await repo.audit('studio', studioId, 'production_file.uploaded', actorEmail(c.req.raw), { fileId, name: body.fileName }).catch(() => undefined);
  const baseUrl = c.env.APP_BASE_URL ?? `https://audiobooks.samawy-ops.com`;
  await sendEmail({
    to: studio.contact_email, toName: studio.name,
    subject: 'ملف إنتاج جديد متاح في بوابتك',
    html: notifyEmail({
      eyebrow: 'بوابة الاستوديو', heading: 'ملف إنتاج جديد',
      body: `تم رفع ملف جديد بعنوان "<strong>${body.fileName}</strong>" إلى بوابة ${studio.name}.`,
      ctaLabel: 'الدخول إلى البوابة', link: `${baseUrl}/studio/${studio.slug}`,
      info: { type: 'DOC', name: body.fileName, meta: studio.name },
    }),
    emailBinding: c.env.EMAIL,
  }).catch(() => undefined);
  return c.json({ ok: true, fileId });
});

studios.patch('/:id/production-files/:fileId/meta', requireStudiosAccess(), async (c) => {
  const body = z.object({ name: z.string().min(1).optional(), bookAuthor: z.string().nullable().optional(), acqNotes: z.string().nullable().optional() }).parse(await c.req.json());
  const repo = new Repository(c.env.DB);
  const file = await repo.getStudioProductionFile(c.req.param('fileId')!);
  if (!file || file.studio_id !== c.req.param('id')) return c.json({ error: 'Production file not found' }, 404);
  await repo.setStudioProductionFileMeta(file.id, body);
  return c.json({ ok: true });
});

studios.delete('/:id/production-files/:fileId', requireStudiosAccess(), async (c) => {
  const repo = new Repository(c.env.DB);
  const file = await repo.getStudioProductionFile(c.req.param('fileId')!);
  if (!file || file.studio_id !== c.req.param('id')) return c.json({ error: 'Production file not found' }, 404);
  if (file.audiobook_id) return c.json({ error: 'This file is assigned to a catalog title and in production. Unassign it first.' }, 400);
  const deleted = await repo.deleteStudioProductionFile(file.id);
  if (deleted?.object_key) await c.env.ASSET_BUCKET.delete(deleted.object_key);
  return c.json({ ok: true });
});

// Assign (or clear) the catalog title a production file narrates.
studios.patch('/:id/production-files/:fileId/assign', requireStudiosAccess(), async (c) => {
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

studios.get('/:id/samples', requireStudiosAccess(), async (c) => {
  const repo = new Repository(c.env.DB);
  const [samples, files] = await Promise.all([
    repo.listStudioSamples(c.req.param('id')!),
    repo.listStudioProductionFiles(c.req.param('id')!),
  ]);
  const fileNameById = new Map(files.map((f) => [f.id, f.name]));
  return c.json({ samples: samples.map((s) => sampleToApi(s, s.book_id ? fileNameById.get(s.book_id) ?? null : null)) });
});

// Admin deletes an uploaded sample (and its audio object).
studios.delete('/:id/samples/:sampleId', requireStudiosAccess(), async (c) => {
  const repo = new Repository(c.env.DB);
  const deleted = await repo.deleteStudioSample(c.req.param('id')!, c.req.param('sampleId')!);
  if (!deleted) return c.json({ error: 'Sample not found' }, 404);
  if (deleted.object_key) await c.env.ASSET_BUCKET.delete(deleted.object_key).catch(() => undefined);
  await repo.audit('studio', c.req.param('id')!, 'sample.deleted', actorEmail(c.req.raw), { sampleId: c.req.param('sampleId') }).catch(() => undefined);
  return c.json({ ok: true });
});

studios.post('/:id/samples/:sampleId/review', requireStudiosAccess(), async (c) => {
  const { status, note } = z.object({ status: z.enum(['approved', 'refused']), note: z.string().nullable().optional() }).parse(await c.req.json());
  const studioId = c.req.param('id')!;
  const sampleId = c.req.param('sampleId')!;
  const repo = new Repository(c.env.DB);
  const studio = await repo.getStudio(studioId);
  const sample = await repo.getStudioSample(sampleId);
  if (!studio || !sample) return c.json({ error: 'Not found' }, 404);
  await repo.reviewStudioSample(sampleId, status, actorEmail(c.req.raw), note ?? null);
  await repo.audit('studio', studioId, 'sample.reviewed', actorEmail(c.req.raw), { sampleId, name: sample.name, status, note: note ?? null }).catch(() => undefined);
  const baseUrl = c.env.APP_BASE_URL ?? `https://audiobooks.samawy-ops.com`;
  const statusAr = status === 'approved' ? 'موافقة' : 'رفض';
  await sendEmail({
    to: studio.contact_email, toName: studio.name,
    subject: `تحديث حالة العينة — ${statusAr}`,
    html: sampleReviewedEmail({
      sampleName: sample.name, studioName: studio.name, status,
      reviewNote: note ?? (status === 'approved' ? 'لا توجد ملاحظات.' : '—'),
      ctaLabel: 'الدخول إلى البوابة', link: `${baseUrl}/studio/${studio.slug}`,
    }),
    emailBinding: c.env.EMAIL,
  });
  return c.json({ ok: true });
});

export default studios;

import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { Env } from '../types';
import { Repository } from '../db';
import { verifyStudioSessionCookie } from './studio-auth';
import { createUploadUrl } from '../pipeline';
import { signInternalArtifactUrl } from '../utils';
import { sendEmail, notifyOperatorsEmail } from '../email';
import { keySegments, nowIso } from '../utils';

const studioPortal = new Hono<{ Bindings: Env }>();

async function requireStudioSession(c: Context<{ Bindings: Env }>, slug: string) {
  const session = await verifyStudioSessionCookie(c.req.header('Cookie') ?? null, c.env.INTERNAL_API_SECRET);
  if (!session || session.slug !== slug) return null;
  return session;
}

function driveUploadToApi(d: { id: string; studio_id: string; name: string; object_key: string; drive_file_id: string | null; status: string; error: string | null; created_at: string; batch_id: string | null; audiobook_id: string | null }) {
  return { id: d.id, studioId: d.studio_id, name: d.name, status: d.status as 'pending' | 'uploading' | 'completed' | 'failed', driveFileId: d.drive_file_id, error: d.error, createdAt: d.created_at, batchId: d.batch_id, audiobookId: d.audiobook_id };
}

studioPortal.get('/:slug', async (c) => {
  const slug = c.req.param('slug');
  const session = await requireStudioSession(c, slug);
  if (!session) return c.json({ error: 'Unauthorized' }, 401);
  const repo = new Repository(c.env.DB);
  const studio = await repo.getStudioBySlug(slug);
  if (!studio || !studio.is_active) return c.json({ error: 'Not found' }, 404);
  const [assets, productionFiles, samples, driveUploads] = await Promise.all([
    repo.listStudioAssets(studio.id),
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
  return c.json({
    studio: { id: studio.id, name: studio.name, slug: studio.slug, contactEmail: studio.contact_email, driveFolderId: studio.drive_folder_id, logoObjectKey: studio.logo_object_key, isActive: !!studio.is_active, createdAt: studio.created_at, createdBy: studio.created_by },
    assets: assets.map((a) => ({ id: a.id, studioId: a.studio_id, name: a.name, objectKey: a.object_key, contentType: a.content_type, sizeBytes: a.size_bytes, uploadedBy: a.uploaded_by, createdAt: a.created_at })),
    productionFiles: productionFiles.map((f) => ({ id: f.id, studioId: f.studio_id, name: f.name, objectKey: f.object_key, contentType: f.content_type, sizeBytes: f.size_bytes, uploadedBy: f.uploaded_by, createdAt: f.created_at, audiobookId: f.audiobook_id, audiobookTitle: f.audiobook_id ? (titleById.get(f.audiobook_id) ?? null) : null })),
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
  const expiresAt = Date.now() + 60 * 60 * 1000;
  const baseUrl = c.env.APP_BASE_URL ?? `https://${new URL(c.req.url).host}`;
  const url = await signInternalArtifactUrl({ baseUrl, path: `/api/files/${objectKey}`, key: objectKey, method: 'GET', secret: c.env.INTERNAL_API_SECRET, expiresAt });
  return c.json({ url });
});

studioPortal.post('/:slug/production-file-download-url', async (c) => {
  const slug = c.req.param('slug');
  const session = await requireStudioSession(c, slug);
  if (!session) return c.json({ error: 'Unauthorized' }, 401);
  const { objectKey } = z.object({ objectKey: z.string() }).parse(await c.req.json());
  const expiresAt = Date.now() + 60 * 60 * 1000;
  const baseUrl = c.env.APP_BASE_URL ?? `https://${new URL(c.req.url).host}`;
  const url = await signInternalArtifactUrl({ baseUrl, path: `/api/files/${objectKey}`, key: objectKey, method: 'GET', secret: c.env.INTERNAL_API_SECRET, expiresAt });
  return c.json({ url });
});

studioPortal.post('/:slug/drive-upload-url', async (c) => {
  const slug = c.req.param('slug');
  const session = await requireStudioSession(c, slug);
  if (!session) return c.json({ error: 'Unauthorized' }, 401);
  const { fileName, contentType, sizeBytes, audiobookId } = z.object({ fileName: z.string(), contentType: z.string(), sizeBytes: z.number().optional(), audiobookId: z.string().nullable().optional() }).parse(await c.req.json());
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
  const key = keySegments('studios', studio.id, 'deliveries', `${Date.now()}-${fileName}`);
  const upload = await createUploadUrl(c.env, key, contentType);
  const uploadId = await repo.createDriveUpload({ studioId: studio.id, name: fileName, objectKey: key, audiobookId: audiobookId ?? null });
  return c.json({ ...upload, objectKey: key, uploadId });
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

  const baseUrl = c.env.APP_BASE_URL ?? `https://audiobooks.samawy-ops.com`;
  const notifyOps = async (subject: string, heading: string, body: string, link: string, cta: string) => {
    const operators = (await repo.listOperatorUsers()).filter((op) => op.isActive);
    await Promise.allSettled(operators.map((op) =>
      sendEmail({ to: op.email, subject, html: notifyOperatorsEmail(heading, body, link, cta), emailBinding: c.env.EMAIL }),
    ));
  };

  // ── Assigned delivery: attach finished audio straight to the catalog title,
  //    reset it to pending, and skip intake entirely. ──
  if (upload.audiobook_id) {
    const book = await repo.getAudiobook(upload.audiobook_id);
    const candidate = book?.candidateId ? await repo.getCandidate(book.candidateId) : null;
    if (!book || !candidate) {
      await repo.updateDriveUpload(uploadId, { status: 'failed', error: 'Assigned title is no longer available.' });
      return c.json({ error: 'Assigned title is no longer available.' }, 409);
    }
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
    await repo.updateDriveUpload(uploadId, { status: 'completed' });
    await repo.audit('audiobook_record', book.id, 'delivery.attached', 'studio_portal', { studioId: studio.id, uploadId, objectKey: upload.object_key });
    await notifyOps(
      `تسليم صوت جاهز من ${studio.name}`,
      `تسليم جديد للعنوان: ${book.title}`,
      `سلّم استوديو ${studio.name} الصوت النهائي للعنوان "<strong>${book.title}</strong>". جاهز لتحضير المقاطع والمعالجة.`,
      `${baseUrl}/books/${book.id}`,
      'تحضير المقاطع',
    );
    return c.json({ ok: true, mode: 'assigned', audiobookId: book.id });
  }

  // ── Unassigned delivery: create an upload-type intake batch pointed straight
  //    at the delivered R2 object, for operator metadata + reconciliation. ──
  const batch = await repo.createBatch({ id: crypto.randomUUID(), sourceType: 'upload', uploadObjectKey: upload.object_key, studioId: studio.id });
  if (batch) {
    await repo.linkDriveUploadsToBatch([uploadId], batch.id);
    await repo.updateDriveUpload(uploadId, { status: 'completed' });
    await repo.audit('ingestion_batch', batch.id, 'created', 'studio_portal', { source: 'studio_delivery_unassigned', studioId: studio.id, uploadId });
    await notifyOps(
      `تسليم جديد بحاجة لمعالجة من ${studio.name}`,
      `تسليم غير مرتبط بعنوان من ${studio.name}`,
      `رفع استوديو ${studio.name} ملفاً بعنوان "<strong>${upload.name}</strong>" غير مرتبط بعنوان. أنشئنا دفعة استيراد بانتظار بيانات التعريف.`,
      `${baseUrl}/batches/${batch.id}`,
      'فتح الدفعة',
    );
  } else {
    await repo.updateDriveUpload(uploadId, { status: 'failed', error: 'Failed to create intake batch.' });
    return c.json({ error: 'Failed to create intake batch.' }, 500);
  }
  return c.json({ ok: true, mode: 'unassigned', batchId: batch.id });
});

studioPortal.post('/:slug/sample-upload-url', async (c) => {
  const slug = c.req.param('slug');
  const session = await requireStudioSession(c, slug);
  if (!session) return c.json({ error: 'Unauthorized' }, 401);
  const { fileName, contentType, sizeBytes, bookId } = z.object({ fileName: z.string(), contentType: z.string(), sizeBytes: z.number().optional(), bookId: z.string().optional() }).parse(await c.req.json());
  const repo = new Repository(c.env.DB);
  const studio = await repo.getStudioBySlug(slug);
  if (!studio) return c.json({ error: 'Not found' }, 404);
  const key = keySegments('studios', studio.id, 'samples', `${Date.now()}-${fileName}`);
  const upload = await createUploadUrl(c.env, key, contentType);
  const sampleId = await repo.createStudioSample({ studioId: studio.id, bookId: bookId ?? null, name: fileName, objectKey: key, contentType, sizeBytes: sizeBytes ?? 0 });
  // Notify operators
  const operators = await repo.listOperatorUsers();
  const baseUrl = c.env.APP_BASE_URL ?? `https://${new URL(c.req.url).host}`;
  await Promise.allSettled(operators.filter((op) => op.isActive).map((op) =>
    sendEmail({
      to: op.email,
      subject: `عينة جديدة من ${studio.name}`,
      html: notifyOperatorsEmail(
        `عينة جديدة: ${fileName}`,
        `رفع استوديو ${studio.name} عينة جديدة بعنوان "<strong>${fileName}</strong>" تنتظر مراجعتك.`,
        `${baseUrl}/studios/${studio.id}`,
        'مراجعة العينات'
      ),
      emailBinding: c.env.EMAIL,
    })
  ));
  return c.json({ ...upload, objectKey: key, sampleId });
});

export default studioPortal;

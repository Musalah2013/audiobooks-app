import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { Env } from '../types';
import { Repository } from '../db';
import { verifyAcquisitionSessionCookie } from './acquisition-auth';
import { createUploadUrl } from '../pipeline';
import { sendEmail, notifyEmail } from '../email';
import { keySegments } from '../utils';
import { searchSamawySellers, fetchSamawyGenres } from '../integrations';
import { hashPassword, verifyPassword } from '../password';

const acquisitionPortal = new Hono<{ Bindings: Env }>();

// A signed-in acquisition member changes their own password.
acquisitionPortal.post('/change-password', async (c) => {
  const session = await verifyAcquisitionSessionCookie(c.req.header('Cookie') ?? null, c.env.INTERNAL_API_SECRET);
  if (!session) return c.json({ error: 'Unauthorized' }, 401);
  const { currentPassword, newPassword } = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8) }).parse(await c.req.json());
  const repo = new Repository(c.env.DB);
  const user = await repo.getAcquisitionUser(session.acquisitionUserId);
  if (!user || !user.password_hash || !(await verifyPassword(currentPassword, user.password_hash))) {
    return c.json({ error: 'Current password is incorrect.' }, 400);
  }
  await repo.setAcquisitionUserPassword(user.id, await hashPassword(newPassword));
  return c.json({ ok: true });
});

// Rich, delivery-style catalog metadata captured by the acquisition member.
const acqMetadataSchema = z.object({
  sellerId: z.number().nullish(),
  sellerName: z.string().nullish(),
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

async function requireAcquisitionSession(c: Context<{ Bindings: Env }>) {
  return verifyAcquisitionSessionCookie(c.req.header('Cookie') ?? null, c.env.INTERNAL_API_SECRET);
}

acquisitionPortal.get('/', async (c) => {
  const session = await requireAcquisitionSession(c);
  if (!session) return c.json({ error: 'Unauthorized' }, 401);
  const repo = new Repository(c.env.DB);
  const studios = await repo.listStudios();
  const result = await Promise.all(
    studios.filter((s) => s.is_active).map(async (s) => {
      const [productionFiles, driveUploads] = await Promise.all([
        repo.listStudioProductionFiles(s.id),
        repo.listDriveUploads(s.id),
      ]);
      return {
        studio: { id: s.id, name: s.name, slug: s.slug, contactEmail: s.contact_email, logoObjectKey: s.logo_object_key, isActive: !!s.is_active, createdAt: s.created_at, createdBy: s.created_by },
        productionFiles: productionFiles.map((f) => ({ id: f.id, studioId: f.studio_id, name: f.name, objectKey: f.object_key, contentType: f.content_type, sizeBytes: f.size_bytes, uploadedBy: f.uploaded_by, createdAt: f.created_at, audiobookId: f.audiobook_id, bookAuthor: f.book_author, acqNotes: f.acq_notes, acqMetadata: f.acq_metadata ? (() => { try { return JSON.parse(f.acq_metadata!); } catch { return null; } })() : null, productionStatus: f.production_status ?? 'backlog' })),
        driveUploads: driveUploads.map((d) => ({ id: d.id, studioId: d.studio_id, name: d.name, status: d.status, driveFileId: d.drive_file_id, error: d.error, createdAt: d.created_at })),
      };
    })
  );
  return c.json({ studios: result });
});

// Returns a presigned upload URL only — the DB row is created on /complete so a
// failed/abandoned upload never leaves a ghost production file.
acquisitionPortal.post('/studios/:studioId/production-file-upload-url', async (c) => {
  const session = await requireAcquisitionSession(c);
  if (!session) return c.json({ error: 'Unauthorized' }, 401);
  const repo = new Repository(c.env.DB);
  const acqUser = await repo.getAcquisitionUser(session.acquisitionUserId);
  if (!acqUser || !acqUser.is_active) return c.json({ error: 'Account inactive' }, 403);
  const { fileName, contentType } = z.object({ fileName: z.string(), contentType: z.string().default('application/pdf'), sizeBytes: z.number().optional() }).parse(await c.req.json());
  const studioId = c.req.param('studioId');
  const studio = await repo.getStudio(studioId);
  if (!studio || !studio.is_active) return c.json({ error: 'Studio not found' }, 404);
  // TODO: Add acquisition_user_studio junction table for fine-grained authorization
  const key = keySegments('studios', studioId, 'production', `${Date.now()}-${fileName}`);
  const upload = await createUploadUrl(c.env, key, contentType);
  return c.json({ ...upload, objectKey: key });
});

// Create the production-file row after the upload landed, then notify the studio.
acquisitionPortal.post('/studios/:studioId/production-files/complete', async (c) => {
  const session = await requireAcquisitionSession(c);
  if (!session) return c.json({ error: 'Unauthorized' }, 401);
  const repo = new Repository(c.env.DB);
  const acqUser = await repo.getAcquisitionUser(session.acquisitionUserId);
  if (!acqUser || !acqUser.is_active) return c.json({ error: 'Account inactive' }, 403);
  const body = z.object({ objectKey: z.string(), fileName: z.string(), contentType: z.string().default('application/pdf'), sizeBytes: z.number().optional(), acqNotes: z.string().nullish(), metadata: acqMetadataSchema.nullish() }).parse(await c.req.json());
  const studioId = c.req.param('studioId');
  const studio = await repo.getStudio(studioId);
  if (!studio || !studio.is_active) return c.json({ error: 'Studio not found' }, 404);
  const object = await c.env.ASSET_BUCKET.head(body.objectKey);
  if (!object) return c.json({ error: 'Uploaded file not found in storage.' }, 404);
  const uploaderName = acqUser.name ?? 'acquisition';
  // The book title comes from the rich metadata when provided, else the file name.
  const name = body.metadata?.title?.trim() || body.fileName;
  const fileId = await repo.createStudioProductionFile({ studioId, name, objectKey: body.objectKey, contentType: body.contentType, sizeBytes: body.sizeBytes ?? object.size, uploadedBy: uploaderName, bookAuthor: body.metadata?.author ?? null, acqNotes: body.acqNotes ?? null, acqMetadata: body.metadata ? JSON.stringify(body.metadata) : null });
  const baseUrl = c.env.APP_BASE_URL ?? `https://${new URL(c.req.url).host}`;
  await sendEmail({
    to: studio.contact_email, toName: studio.name,
    subject: 'ملف إنتاج جديد متاح في بوابتك',
    html: notifyEmail({
      eyebrow: 'بوابة الاستوديو', heading: 'ملف إنتاج جديد',
      body: `تم رفع ملف جديد بعنوان "<strong>${name}</strong>" إلى بوابة ${studio.name}.`,
      ctaLabel: 'الدخول إلى البوابة', link: `${baseUrl}/studio/${studio.slug}`,
      info: { type: 'DOC', name, meta: studio.name },
    }),
    emailBinding: c.env.EMAIL,
  }).catch(() => undefined);
  return c.json({ ok: true, fileId });
});

acquisitionPortal.patch('/studios/:studioId/production-files/:fileId/meta', async (c) => {
  const session = await requireAcquisitionSession(c);
  if (!session) return c.json({ error: 'Unauthorized' }, 401);
  const repo = new Repository(c.env.DB);
  const acqUser = await repo.getAcquisitionUser(session.acquisitionUserId);
  if (!acqUser || !acqUser.is_active) return c.json({ error: 'Account inactive' }, 403);
  const body = z.object({ acqNotes: z.string().nullable().optional(), metadata: acqMetadataSchema }).parse(await c.req.json());
  const file = await repo.getStudioProductionFile(c.req.param('fileId'));
  if (!file || file.studio_id !== c.req.param('studioId')) return c.json({ error: 'Production file not found' }, 404);
  if (file.audiobook_id) return c.json({ error: 'This file is assigned to a catalog title and in production. It can no longer be edited here.' }, 400);
  await repo.setStudioProductionFileMeta(file.id, {
    name: body.metadata.title.trim(),
    bookAuthor: body.metadata.author ?? null,
    acqNotes: body.acqNotes ?? null,
    acqMetadata: JSON.stringify(body.metadata),
  });
  return c.json({ ok: true });
});

// Publisher search + catalog genres for the acquisition metadata form (the
// /api/sellers routes sit behind operator auth, so the acq portal proxies them).
acquisitionPortal.get('/sellers', async (c) => {
  const session = await requireAcquisitionSession(c);
  if (!session) return c.json({ error: 'Unauthorized' }, 401);
  try {
    return c.json({ sellers: await searchSamawySellers(c.env, c.req.query('q') ?? '') });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err), sellers: [] }, 500);
  }
});

acquisitionPortal.get('/genres', async (c) => {
  const session = await requireAcquisitionSession(c);
  if (!session) return c.json({ error: 'Unauthorized' }, 401);
  try {
    return c.json({ genres: await fetchSamawyGenres(c.env) });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err), genres: [] }, 500);
  }
});

acquisitionPortal.delete('/studios/:studioId/production-files/:fileId', async (c) => {
  const session = await requireAcquisitionSession(c);
  if (!session) return c.json({ error: 'Unauthorized' }, 401);
  const repo = new Repository(c.env.DB);
  const acqUser = await repo.getAcquisitionUser(session.acquisitionUserId);
  if (!acqUser || !acqUser.is_active) return c.json({ error: 'Account inactive' }, 403);
  const file = await repo.getStudioProductionFile(c.req.param('fileId'));
  if (!file || file.studio_id !== c.req.param('studioId')) return c.json({ error: 'Production file not found' }, 404);
  if (file.audiobook_id) return c.json({ error: 'This file is assigned to a catalog title and in production. Unassign it first.' }, 400);
  const deleted = await repo.deleteStudioProductionFile(file.id);
  if (deleted?.object_key) await c.env.ASSET_BUCKET.delete(deleted.object_key);
  return c.json({ ok: true });
});

export default acquisitionPortal;

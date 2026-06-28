import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { Env } from '../types';
import { Repository } from '../db';
import { verifyAcquisitionSessionCookie } from './acquisition-auth';
import { createUploadUrl } from '../pipeline';
import { sendEmail, notifyOperatorsEmail } from '../email';
import { keySegments } from '../utils';

const acquisitionPortal = new Hono<{ Bindings: Env }>();

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
        productionFiles: productionFiles.map((f) => ({ id: f.id, studioId: f.studio_id, name: f.name, objectKey: f.object_key, contentType: f.content_type, sizeBytes: f.size_bytes, uploadedBy: f.uploaded_by, createdAt: f.created_at, audiobookId: f.audiobook_id, bookAuthor: f.book_author, acqNotes: f.acq_notes })),
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
  const body = z.object({ objectKey: z.string(), fileName: z.string(), contentType: z.string().default('application/pdf'), sizeBytes: z.number().optional(), bookAuthor: z.string().nullish(), acqNotes: z.string().nullish() }).parse(await c.req.json());
  const studioId = c.req.param('studioId');
  const studio = await repo.getStudio(studioId);
  if (!studio || !studio.is_active) return c.json({ error: 'Studio not found' }, 404);
  const object = await c.env.ASSET_BUCKET.head(body.objectKey);
  if (!object) return c.json({ error: 'Uploaded file not found in storage.' }, 404);
  const uploaderName = acqUser.name ?? 'acquisition';
  const fileId = await repo.createStudioProductionFile({ studioId, name: body.fileName, objectKey: body.objectKey, contentType: body.contentType, sizeBytes: body.sizeBytes ?? object.size, uploadedBy: uploaderName, bookAuthor: body.bookAuthor ?? null, acqNotes: body.acqNotes ?? null });
  const baseUrl = c.env.APP_BASE_URL ?? `https://${new URL(c.req.url).host}`;
  await sendEmail({
    to: studio.contact_email, toName: studio.name,
    subject: 'ملف إنتاج جديد متاح في بوابتك',
    html: notifyOperatorsEmail(
      'ملف إنتاج جديد',
      `تم رفع ملف جديد بعنوان "<strong>${body.fileName}</strong>" إلى بوابة ${studio.name}.`,
      `${baseUrl}/studio/${studio.slug}`,
      'الدخول إلى البوابة'
    ),
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
  const body = z.object({ name: z.string().min(1).optional(), bookAuthor: z.string().nullable().optional(), acqNotes: z.string().nullable().optional() }).parse(await c.req.json());
  const file = await repo.getStudioProductionFile(c.req.param('fileId'));
  if (!file || file.studio_id !== c.req.param('studioId')) return c.json({ error: 'Production file not found' }, 404);
  if (file.audiobook_id) return c.json({ error: 'This file is assigned to a catalog title and in production. It can no longer be edited here.' }, 400);
  await repo.setStudioProductionFileMeta(file.id, body);
  return c.json({ ok: true });
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

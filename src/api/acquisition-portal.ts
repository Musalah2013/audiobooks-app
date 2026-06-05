import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../types';
import { Repository } from '../db';
import { verifyAcquisitionSessionCookie } from './acquisition-auth';
import { createUploadUrl } from '../pipeline';
import { sendEmail, notifyOperatorsEmail } from '../email';
import { keySegments } from '../utils';

const acquisitionPortal = new Hono<{ Bindings: Env }>();

async function requireAcquisitionSession(c: Parameters<Parameters<typeof acquisitionPortal.use>[1]>[0]) {
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
        studio: { id: s.id, name: s.name, slug: s.slug, contactEmail: s.contact_email, driveFolderId: s.drive_folder_id, logoObjectKey: s.logo_object_key, isActive: !!s.is_active, createdAt: s.created_at, createdBy: s.created_by },
        productionFiles: productionFiles.map((f) => ({ id: f.id, studioId: f.studio_id, name: f.name, objectKey: f.object_key, contentType: f.content_type, sizeBytes: f.size_bytes, uploadedBy: f.uploaded_by, createdAt: f.created_at })),
        driveUploads: driveUploads.map((d) => ({ id: d.id, studioId: d.studio_id, name: d.name, status: d.status, driveFileId: d.drive_file_id, error: d.error, createdAt: d.created_at })),
      };
    })
  );
  return c.json({ studios: result });
});

acquisitionPortal.post('/studios/:studioId/production-file-upload-url', async (c) => {
  const session = await requireAcquisitionSession(c);
  if (!session) return c.json({ error: 'Unauthorized' }, 401);
  const { fileName, contentType, sizeBytes } = z.object({ fileName: z.string(), contentType: z.string().default('application/pdf'), sizeBytes: z.number().optional() }).parse(await c.req.json());
  const studioId = c.req.param('studioId');
  const repo = new Repository(c.env.DB);
  const studio = await repo.getStudio(studioId);
  if (!studio || !studio.is_active) return c.json({ error: 'Studio not found' }, 404);
  const acqUser = await repo.getAcquisitionUser(session.acquisitionUserId);
  const uploaderName = acqUser?.name ?? 'acquisition';
  const key = keySegments('studios', studioId, 'production', `${Date.now()}-${fileName}`);
  const upload = await createUploadUrl(c.env, key, contentType);
  const fileId = await repo.createStudioProductionFile({ studioId, name: fileName, objectKey: key, contentType, sizeBytes: sizeBytes ?? 0, uploadedBy: uploaderName });
  // Notify studio
  const baseUrl = c.env.APP_BASE_URL ?? `https://${new URL(c.req.url).host}`;
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

acquisitionPortal.delete('/studios/:studioId/production-files/:fileId', async (c) => {
  const session = await requireAcquisitionSession(c);
  if (!session) return c.json({ error: 'Unauthorized' }, 401);
  const repo = new Repository(c.env.DB);
  const deleted = await repo.deleteStudioProductionFile(c.req.param('fileId'));
  if (deleted?.object_key) await c.env.ASSET_BUCKET.delete(deleted.object_key);
  return c.json({ ok: true });
});

export default acquisitionPortal;

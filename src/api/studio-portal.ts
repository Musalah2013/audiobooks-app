import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../types';
import { Repository } from '../db';
import { verifyStudioSessionCookie } from './studio-auth';
import { createUploadUrl } from '../pipeline';
import { signInternalArtifactUrl } from '../utils';
import { sendEmail, notifyOperatorsEmail } from '../email';
import { keySegments, nowIso } from '../utils';

const studioPortal = new Hono<{ Bindings: Env }>();

async function requireStudioSession(c: Parameters<Parameters<typeof studioPortal.use>[1]>[0], slug: string) {
  const session = await verifyStudioSessionCookie(c.req.header('Cookie') ?? null, c.env.INTERNAL_API_SECRET);
  if (!session || session.slug !== slug) return null;
  return session;
}

function driveUploadToApi(d: { id: string; studio_id: string; name: string; object_key: string; drive_file_id: string | null; status: string; error: string | null; created_at: string }) {
  return { id: d.id, studioId: d.studio_id, name: d.name, status: d.status as 'pending' | 'uploading' | 'completed' | 'failed', driveFileId: d.drive_file_id, error: d.error, createdAt: d.created_at };
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
  return c.json({
    studio: { id: studio.id, name: studio.name, slug: studio.slug, contactEmail: studio.contact_email, driveFolderId: studio.drive_folder_id, logoObjectKey: studio.logo_object_key, isActive: !!studio.is_active, createdAt: studio.created_at, createdBy: studio.created_by },
    assets: assets.map((a) => ({ id: a.id, studioId: a.studio_id, name: a.name, objectKey: a.object_key, contentType: a.content_type, sizeBytes: a.size_bytes, uploadedBy: a.uploaded_by, createdAt: a.created_at })),
    productionFiles: productionFiles.map((f) => ({ id: f.id, studioId: f.studio_id, name: f.name, objectKey: f.object_key, contentType: f.content_type, sizeBytes: f.size_bytes, uploadedBy: f.uploaded_by, createdAt: f.created_at })),
    samples: samples.map((s) => ({ id: s.id, studioId: s.studio_id, name: s.name, objectKey: s.object_key, contentType: s.content_type, sizeBytes: s.size_bytes, status: s.status, reviewedBy: s.reviewed_by, reviewNote: s.review_note, reviewedAt: s.reviewed_at, createdAt: s.created_at })),
    driveUploads: driveUploads.map(driveUploadToApi),
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
  const { fileName, contentType, sizeBytes } = z.object({ fileName: z.string(), contentType: z.string(), sizeBytes: z.number().optional() }).parse(await c.req.json());
  const repo = new Repository(c.env.DB);
  const studio = await repo.getStudioBySlug(slug);
  if (!studio) return c.json({ error: 'Not found' }, 404);
  const key = keySegments('studios', studio.id, 'drive-uploads', `${Date.now()}-${fileName}`);
  const upload = await createUploadUrl(c.env, key, contentType);
  const uploadId = await repo.createDriveUpload({ studioId: studio.id, name: fileName, objectKey: key });
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
  await repo.updateDriveUpload(uploadId, { status: 'pending' });
  // Enqueue Drive sync if binding available
  if (c.env.STUDIO_DRIVE_SYNC_QUEUE) {
    await c.env.STUDIO_DRIVE_SYNC_QUEUE.send({ driveUploadId: uploadId });
  }
  // Notify operators
  const studio = await repo.getStudioBySlug(slug);
  if (studio) {
    const operators = await repo.listOperatorUsers();
    const activeOps = operators.filter((op) => op.isActive);
    const baseUrl = c.env.APP_BASE_URL?.replace('samawy-ops.com', 'audiobooks.samawy-ops.com') ?? `https://audiobooks.samawy-ops.com`;
    await Promise.allSettled(activeOps.map((op) =>
      sendEmail({
        to: op.email,
        subject: `استوديو ${studio.name} رفع ملفاً جديداً`,
        html: notifyOperatorsEmail(`ملف جديد من ${studio.name}`, `رفع الاستوديو ملف جديد بعنوان "<strong>${upload.name}</strong>". سيتم مزامنته مع Google Drive قريباً. <a href="${baseUrl}/studios/${studio.id}">إدارة الاستوديو</a>`),
        emailBinding: c.env.EMAIL,
      })
    ));
  }
  return c.json({ ok: true });
});

studioPortal.post('/:slug/sample-upload-url', async (c) => {
  const slug = c.req.param('slug');
  const session = await requireStudioSession(c, slug);
  if (!session) return c.json({ error: 'Unauthorized' }, 401);
  const { fileName, contentType, sizeBytes } = z.object({ fileName: z.string(), contentType: z.string(), sizeBytes: z.number().optional() }).parse(await c.req.json());
  const repo = new Repository(c.env.DB);
  const studio = await repo.getStudioBySlug(slug);
  if (!studio) return c.json({ error: 'Not found' }, 404);
  const key = keySegments('studios', studio.id, 'samples', `${Date.now()}-${fileName}`);
  const upload = await createUploadUrl(c.env, key, contentType);
  const sampleId = await repo.createStudioSample({ studioId: studio.id, name: fileName, objectKey: key, contentType, sizeBytes: sizeBytes ?? 0 });
  // Notify operators
  const operators = await repo.listOperatorUsers();
  const baseUrl = c.env.APP_BASE_URL ?? `https://${new URL(c.req.url).host}`;
  await Promise.allSettled(operators.filter((op) => op.isActive).map((op) =>
    sendEmail({
      to: op.email,
      subject: `عينة جديدة من ${studio.name}`,
      html: notifyOperatorsEmail(`عينة جديدة: ${fileName}`, `رفع استوديو ${studio.name} عينة جديدة بعنوان "<strong>${fileName}</strong>" تنتظر مراجعتك. <a href="${baseUrl}/studios/${studio.id}">مراجعة العينات</a>`),
      emailBinding: c.env.EMAIL,
    })
  ));
  return c.json({ ...upload, objectKey: key, sampleId });
});

export default studioPortal;

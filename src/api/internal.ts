import { Hono } from 'hono';
import { Repository } from '../db';
import { signMultipartUrl, verifyInternalArtifactRequest, verifyMultipartRequest } from '../utils';
import type { Env } from '../types';

const internal = new Hono<{ Bindings: Env }>();

internal.get('/artifacts', async (c) => {
  const verification = await verifyInternalArtifactRequest({
    url: new URL(c.req.url),
    secret: c.env.INTERNAL_API_SECRET,
    method: "GET",
  });
  if (!verification.ok || !verification.key) return c.json({ error: "Unauthorized" }, 401);
  const object = await c.env.ASSET_BUCKET.get(verification.key);
  if (!object) return c.json({ error: "Not found" }, 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  return new Response(object.body, { headers });
});

internal.put('/artifacts', async (c) => {
  const verification = await verifyInternalArtifactRequest({
    url: new URL(c.req.url),
    secret: c.env.INTERNAL_API_SECRET,
    method: "PUT",
  });
  if (!verification.ok || !verification.key) return c.json({ error: "Unauthorized" }, 401);
  await c.env.ASSET_BUCKET.put(verification.key, c.req.raw.body, {
    httpMetadata: { contentType: c.req.header("content-type") ?? "application/octet-stream" },
  });
  return c.json({ ok: true, key: verification.key });
});

internal.post('/track-progress', async (c) => {
  const secret = c.req.header("X-Internal-Secret");
  if (secret !== c.env.INTERNAL_API_SECRET) return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json() as {
    audiobookId?: string;
    originalFilename?: string;
    originalSizeBytes?: number;
    originalDurationSeconds?: number;
    originalBitrateKbps?: number;
    originalSampleRateHz?: number;
    originalChannels?: number;
    finalObjectKey?: string;
    finalFilename?: string;
    finalTitle?: string;
    finalSizeBytes?: number;
    finalDurationSeconds?: number;
    finalBitrateKbps?: number;
    finalSampleRateHz?: number;
    finalChannels?: number;
    notes?: string;
  };
  const { audiobookId, originalFilename, ...fields } = body;
  if (!audiobookId || !originalFilename) return c.json({ error: "audiobookId and originalFilename required" }, 400);
  const repo = new Repository(c.env.DB);
  await repo.applyProcessingTracks(audiobookId, [{
    originalFilename,
    originalSizeBytes: fields.originalSizeBytes ?? 0,
    originalDurationSeconds: fields.originalDurationSeconds ?? 0,
    originalBitrateKbps: fields.originalBitrateKbps,
    originalSampleRateHz: fields.originalSampleRateHz,
    originalChannels: fields.originalChannels,
    finalObjectKey: fields.finalObjectKey,
    finalFilename: fields.finalFilename,
    finalTitle: fields.finalTitle,
    finalSizeBytes: fields.finalSizeBytes,
    finalDurationSeconds: fields.finalDurationSeconds,
    finalBitrateKbps: fields.finalBitrateKbps,
    finalSampleRateHz: fields.finalSampleRateHz,
    finalChannels: fields.finalChannels,
    notes: fields.notes,
  }]);
  return c.json({ ok: true });
});

internal.post('/processing-progress', async (c) => {
  const secret = c.req.header("X-Internal-Secret");
  if (secret !== c.env.INTERNAL_API_SECRET) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const body = await c.req.json();
  const processingRunId = String(body?.processingRunId ?? "");
  const step = String(body?.step ?? "progress");
  const message = String(body?.message ?? "");
  const status = body?.status ? String(body.status) : null;
  if (!processingRunId || !message) {
    return c.json({ error: "processingRunId and message are required" }, 400);
  }
  const repo = new Repository(c.env.DB);
  if (status) {
    await repo.updateProcessingRun(processingRunId, { status });
  }
  await repo.audit("processing_run", processingRunId, `progress.${step}`, "container", {
    message,
    step,
    status,
  });
  return c.json({ ok: true });
});

internal.post('/multipart-start', async (c) => {
  const verification = await verifyMultipartRequest({
    url: new URL(c.req.url),
    secret: c.env.INTERNAL_API_SECRET,
    method: "POST",
  });
  if (!verification.ok || !verification.key) return c.json({ error: "Unauthorized" }, 401);
  const numParts = Number(new URL(c.req.url).searchParams.get("numParts") ?? "0");
  if (!Number.isFinite(numParts) || numParts < 1) return c.json({ error: "numParts required" }, 400);
  const contentType = new URL(c.req.url).searchParams.get("contentType") || "application/zip";

  const upload = await c.env.ASSET_BUCKET.createMultipartUpload(verification.key, {
    httpMetadata: { contentType },
  });
  const expiresAt = Date.now() + 4 * 60 * 60 * 1000;
  const baseUrl = c.env.APP_BASE_URL ?? `${new URL(c.req.url).protocol}//${new URL(c.req.url).host}`;
  const partUrls = await Promise.all(
    Array.from({ length: numParts }, (_, i) =>
      signMultipartUrl({
        baseUrl,
        path: "/api/internal/multipart-part",
        key: verification.key!,
        uploadId: upload.uploadId,
        part: i + 1,
        method: "PUT",
        secret: c.env.INTERNAL_API_SECRET,
        expiresAt,
      }),
    ),
  );
  const completeUrl = await signMultipartUrl({
    baseUrl,
    path: "/api/internal/multipart-complete",
    key: verification.key,
    uploadId: upload.uploadId,
    method: "POST",
    secret: c.env.INTERNAL_API_SECRET,
    expiresAt,
  });
  return c.json({ uploadId: upload.uploadId, partUrls, completeUrl });
});

internal.put('/multipart-part', async (c) => {
  const verification = await verifyMultipartRequest({
    url: new URL(c.req.url),
    secret: c.env.INTERNAL_API_SECRET,
    method: "PUT",
  });
  if (!verification.ok || !verification.key || !verification.uploadId || verification.part == null) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  if (!c.req.raw.body) return c.json({ error: "Empty body" }, 400);
  const upload = c.env.ASSET_BUCKET.resumeMultipartUpload(verification.key, verification.uploadId);
  const part = await upload.uploadPart(verification.part, c.req.raw.body);
  return c.json({ etag: part.etag, partNumber: verification.part });
});

internal.post('/multipart-complete', async (c) => {
  const verification = await verifyMultipartRequest({
    url: new URL(c.req.url),
    secret: c.env.INTERNAL_API_SECRET,
    method: "POST",
  });
  if (!verification.ok || !verification.key || !verification.uploadId) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const body = await c.req.json() as { parts: Array<{ partNumber: number; etag: string }> };
  if (!Array.isArray(body.parts)) return c.json({ error: "parts required" }, 400);
  const upload = c.env.ASSET_BUCKET.resumeMultipartUpload(verification.key, verification.uploadId);
  await upload.complete(body.parts);
  return c.json({ ok: true });
});

export default internal;

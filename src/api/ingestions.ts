import { Hono } from 'hono';
import { z } from 'zod';
import { Repository } from '../db';
import {
  buildNormalizedGroups,
  generateCandidates,
  materializeApprovedBooks,
  normalizeUploadedBatch,
  parseBatchMetadata,
  remapBatchMetadata,
  revertBatch,
  writeIntakeReport,
  createUploadUrl,
} from '../pipeline';
import type { Env } from '../types';
import { inferIntakeMode, keySegments } from '../utils';
import { getServiceAccountToken, listDriveFiles } from '../integrations';
import { actorEmail, requirePermission } from './auth';

const ingestions = new Hono<{ Bindings: Env }>();

function isWorkbookFileName(name: string) {
  return /\.(xlsx|xlsm|xls)$/i.test(name);
}

function isZipFileName(name: string) {
  return /\.zip$/i.test(name);
}

const manualMetadataSchema = z.object({
  title: z.string().trim().min(1),
  publisher: z.string().trim().min(1),
  subtitle: z.string().trim().optional(),
  genre: z.string().trim().optional(),
  blurb: z.string().trim().optional(),
  author: z.string().trim().optional(),
  isbn: z.string().trim().optional(),
  pubYear: z.string().trim().optional(),
  sellingType: z.enum(["subscription", "a_la_carte"]).optional(),
  price: z.coerce.number().nonnegative().optional(),
  trackCount: z.coerce.number().int().positive().optional(),
  totalOriginalBookSizeBytes: z.coerce.number().nonnegative().optional(),
  totalLengthSeconds: z.coerce.number().nonnegative().optional(),
  narrator: z.string().trim().optional(),
  importancePoints: z.coerce.number().nonnegative().optional(),
});

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requireBatch(repo: Repository, batchId: string) {
  const batch = await repo.getBatch(batchId);
  if (!batch) {
    throw new Error("Batch not found");
  }
  return batch;
}

function requireStatus(current: string, allowed: string[], action: string) {
  if (!allowed.includes(current)) {
    throw new Error(`${action} is only allowed when batch status is ${allowed.join(" or ")}. Current status: ${current}.`);
  }
}

async function enqueueDriveIntake(env: Env, repo: Repository, batchId: string, actor: string) {
  const batch = await requireBatch(repo, batchId);
  if (batch.sourceType !== "drive") {
    throw new Error("Start intake is only available for Drive batches.");
  }
  if (!batch.metadataSheetObjectKey) {
    throw new Error("Attach the metadata workbook before starting Drive import.");
  }
  // "normalizing" and "intake_queued" are included so an operator can recover a
  // batch that got stuck mid-intake (e.g. a single file looping on retries).
  // Re-enqueuing is safe: intake is resumable and idempotent — already-copied
  // files are skipped via R2 size-check, and pending skip requests are honored.
  requireStatus(
    batch.status,
    ["ingested", "metadata_sheet_selected", "intake_failed", "intake_queued", "normalizing"],
    "Start intake",
  );
  await repo.updateBatch(batchId, {
    status: "intake_queued",
    normalization: {
      ...(batch.normalization ?? {}),
      intakeError: undefined,
    },
  });
  await repo.audit("ingestion_batch", batchId, "intake.queued", actor, { sourceType: batch.sourceType });
  await env.INGEST_QUEUE.send({ type: "drive-intake", batchId });
}

ingestions.post('/', async (c) => {
  const repo = new Repository(c.env.DB);
  const body = await c.req.json();
  const parsed = z
    .object({
      sourceType: z.enum(["drive", "upload"]),
      driveLink: z.string().url().optional(),
    })
    .parse(body);
  const batch = await repo.createBatch({
    id: crypto.randomUUID(),
    sourceType: parsed.sourceType,
    driveLink: parsed.driveLink,
  });
  await repo.audit("ingestion_batch", batch!.id, "created", actorEmail(c.req.raw), parsed);
  return c.json({ batch });
});

ingestions.post('/preview-drive', async (c) => {
  const body = await c.req.json();
  const parsed = z.object({ driveLink: z.string().url() }).parse(body);
  try {
    const token = await getServiceAccountToken(c.env);
    const manifest = await listDriveFiles(c.env, parsed.driveLink, token);
    const groups = buildNormalizedGroups(manifest);
    const previewGroups = groups.slice(0, 20).map((group) => ({
      groupKey: group.groupKey,
      displayName: group.displayName,
      inferredTitle: group.inferredTitle,
      itemCount: group.items.length,
      fileNames: group.items.slice(0, 10).map((item) => item.name),
      reasons: group.reasons,
      confidence: group.confidence,
    }));
    const skippedGoogleNativeCount = manifest.filter((item) => item.mimeType.startsWith('application/vnd.google-apps.')).length;
    return c.json({
      ok: true,
      summary: {
        totalFiles: manifest.length,
        totalSizeBytes: manifest.reduce((sum, item) => sum + item.sizeBytes, 0),
        intakeMode: inferIntakeMode(manifest),
        detectedGroups: groups.length,
        skippedGoogleNativeCount,
      },
      groups: previewGroups,
      files: manifest.slice(0, 200),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({
      ok: false,
      error: message,
      guidance:
        message.includes('service account')
          ? 'Share the folder and any shortcut targets with vm-audiobooks-service-account@samawy.iam.gserviceaccount.com.'
          : message.includes('empty')
            ? 'Check whether the folder contains only Google-native files, empty subfolders, or inaccessible shortcuts.'
            : 'Verify the link, sharing, and file layout, then retry.',
    }, 400);
  }
});

ingestions.post('/:id/start-intake', async (c) => {
  const repo = new Repository(c.env.DB);
  try {
    await enqueueDriveIntake(c.env, repo, c.req.param("id"), actorEmail(c.req.raw));
    return c.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "Batch not found") {
      return c.json({ error: error.message }, 404);
    }
    throw error;
  }
});

ingestions.post('/:id/direct-upload-url', async (c) => {
  const repo = new Repository(c.env.DB);
  const batch = await repo.getBatch(c.req.param("id"));
  if (!batch) return c.json({ error: "Batch not found" }, 404);
  const body = await c.req.json();
  const parsed = z.object({ fileName: z.string(), contentType: z.string() }).parse(body);
  if (!isZipFileName(parsed.fileName)) {
    return c.json({ error: "Direct upload intake only accepts a single ZIP file." }, 400);
  }
  const key = keySegments("ingestions", batch.id, "source", parsed.fileName);
  const upload = await createUploadUrl(c.env, key, parsed.contentType);
  await repo.updateBatch(batch.id, { uploadObjectKey: key });
  return c.json({ ...upload, objectKey: key });
});

ingestions.post('/:id/finalize-upload', async (c) => {
  const repo = new Repository(c.env.DB);
  const batch = await repo.getBatch(c.req.param("id"));
  if (!batch || !batch.uploadObjectKey) return c.json({ error: "Batch or upload object not found" }, 404);
  if (batch.sourceType !== "upload") return c.json({ error: "Finalize upload is only available for direct ZIP batches" }, 400);
  if (!Array.isArray(batch.normalization?.metadataRows) || batch.normalization.metadataRows.length === 0) {
    return c.json({ error: "Provide the direct-ingestion metadata form before finalizing the ZIP upload." }, 400);
  }
  const object = await c.env.ASSET_BUCKET.head(batch.uploadObjectKey);
  if (!object) return c.json({ error: "Uploaded object not found" }, 404);

  const manifest = [
    {
      key: batch.uploadObjectKey,
      name: batch.uploadObjectKey.split("/").pop() ?? batch.uploadObjectKey,
      mimeType: object.httpMetadata?.contentType ?? "application/octet-stream",
      sizeBytes: object.size,
      parentPath: "",
    },
  ];
  await repo.updateBatch(batch.id, {
    status: "intake_queued",
    normalization: {
      ...(batch.normalization ?? {}),
      intakeError: undefined,
      intakeProgress: {
        phase: "upload_received",
        totalSourceFiles: manifest.length,
        copiedSourceFiles: manifest.length,
        totalSourceBytes: object.size,
        copiedSourceBytes: object.size,
        totalArchives: /\.zip$/i.test(manifest[0]?.name ?? "") ? 1 : 0,
        extractedArchives: 0,
        extractedEntries: 0,
        currentItem: manifest[0]?.name ?? null,
        activeTransfers: [],
        updatedAt: new Date().toISOString(),
      },
      intakeLogs: [
        ...((((batch.normalization?.intakeLogs as unknown[]) ?? []) as Array<Record<string, unknown>>).slice(-199)),
        {
          at: new Date().toISOString(),
          level: "info",
          message: `Upload complete. Queued normalization for ${manifest[0]?.name ?? "uploaded source"}.`,
        },
      ],
    },
  });
  await c.env.INGEST_QUEUE.send({ type: "upload-intake", batchId: batch.id, manifest });
  return c.json({ ok: true });
});

ingestions.post('/:id/manual-metadata', async (c) => {
  const repo = new Repository(c.env.DB);
  const batch = await requireBatch(repo, c.req.param("id"));
  if (batch.sourceType !== "upload") {
    return c.json({ error: "Manual metadata form is only available for direct ZIP intake." }, 400);
  }
  requireStatus(batch.status, ["ingested", "normalized", "metadata_sheet_pending", "metadata_sheet_selected", "metadata_parsed", "intake_failed"], "Save manual metadata");
  const body = await c.req.json();
  const parsed = manualMetadataSchema.parse(body);
  const row = {
    rowIndex: 1,
    ...parsed,
  };
  const nextStatus = batch.sourceManifest.length > 0 ? "metadata_parsed" : batch.status;
  await repo.updateBatch(batch.id, {
    normalization: {
      ...(batch.normalization ?? {}),
      metadataRows: [row],
    },
    status: nextStatus,
  });
  await repo.audit("ingestion_batch", batch.id, "metadata_form.saved", actorEmail(c.req.raw), {
    title: parsed.title,
    publisher: parsed.publisher,
  });
  return c.json({ ok: true, row });
});

ingestions.post('/:id/select-metadata-sheet', async (c) => {
  const repo = new Repository(c.env.DB);
  const batch = await requireBatch(repo, c.req.param("id"));
  requireStatus(batch.status, ["normalized", "metadata_sheet_pending", "metadata_sheet_selected"], "Select metadata sheet");
  const body = await c.req.json();
  const parsed = z.object({ objectKey: z.string().min(1) }).parse(body);
  const workbookItem = batch.sourceManifest.find((item) => item.key === parsed.objectKey && isWorkbookFileName(item.name));
  if (!workbookItem) {
    return c.json({ error: "Selected file is not a workbook in this batch." }, 400);
  }
  await repo.updateBatch(batch.id, {
    metadataSheetObjectKey: workbookItem.key,
    status: "metadata_sheet_selected",
    normalization: {
      ...(batch.normalization ?? {}),
      metadataRows: undefined,
    },
  });
  await repo.audit("ingestion_batch", batch.id, "metadata_sheet.selected", actorEmail(c.req.raw), {
    objectKey: workbookItem.key,
    name: workbookItem.name,
  });
  return c.json({ ok: true, objectKey: workbookItem.key });
});

ingestions.post('/:id/metadata-upload-url', async (c) => {
  const repo = new Repository(c.env.DB);
  const batch = await requireBatch(repo, c.req.param("id"));
  requireStatus(batch.status, ["ingested", "normalized", "metadata_sheet_pending", "metadata_sheet_selected", "intake_failed", "metadata_parsed", "seller_locked", "reconciliation_in_review"], "Upload metadata sheet");
  const body = await c.req.json();
  const parsed = z.object({ fileName: z.string(), contentType: z.string() }).parse(body);
  if (!isWorkbookFileName(parsed.fileName)) {
    return c.json({ error: "Metadata sheet must be an Excel workbook." }, 400);
  }
  const key = keySegments("ingestions", batch.id, "metadata", parsed.fileName);
  const upload = await createUploadUrl(c.env, key, parsed.contentType);
  return c.json({ ...upload, objectKey: key });
});

ingestions.post('/:id/finalize-metadata-upload', async (c) => {
  const repo = new Repository(c.env.DB);
  const batch = await requireBatch(repo, c.req.param("id"));
  requireStatus(batch.status, ["ingested", "normalized", "metadata_sheet_pending", "metadata_sheet_selected", "intake_failed", "metadata_parsed", "seller_locked", "reconciliation_in_review"], "Finalize metadata upload");
  const body = await c.req.json();
  const parsed = z.object({ objectKey: z.string().min(1) }).parse(body);
  const object = await c.env.ASSET_BUCKET.head(parsed.objectKey);
  if (!object) return c.json({ error: "Uploaded metadata sheet not found" }, 404);
  if (!isWorkbookFileName(parsed.objectKey.split("/").pop() ?? parsed.objectKey)) {
    return c.json({ error: "Uploaded metadata sheet must be an Excel workbook." }, 400);
  }
  await repo.updateBatch(batch.id, {
    metadataSheetObjectKey: parsed.objectKey,
    status: "metadata_sheet_selected",
    normalization: {
      ...(batch.normalization ?? {}),
      metadataRows: undefined,
    },
  });
  await repo.audit("ingestion_batch", batch.id, "metadata_sheet.uploaded", actorEmail(c.req.raw), {
    objectKey: parsed.objectKey,
    sizeBytes: object.size,
  });
  return c.json({ ok: true, objectKey: parsed.objectKey });
});

ingestions.post('/:id/parse-metadata', async (c) => {
  const repo = new Repository(c.env.DB);
  const batch = await requireBatch(repo, c.req.param("id"));
  requireStatus(batch.status, ["metadata_sheet_selected", "metadata_parsed", "seller_locked", "reconciliation_in_review"], "Parse metadata");
  await repo.updateBatch(batch.id, {
    status: "parsing_metadata",
    normalization: {
      ...(batch.normalization ?? {}),
      metadataParseError: undefined,
    },
  });
  await repo.audit("ingestion_batch", batch.id, "metadata.parse.queued", actorEmail(c.req.raw), {
    metadataSheetObjectKey: batch.metadataSheetObjectKey,
  });
  await c.env.INGEST_QUEUE.send({ type: "metadata-parse", batchId: batch.id });
  return c.json({ ok: true, queued: true });
});

ingestions.post('/:id/lock-seller', async (c) => {
  const repo = new Repository(c.env.DB);
  const existingBatch = await requireBatch(repo, c.req.param("id"));
  requireStatus(existingBatch.status, ["metadata_parsed"], "Lock seller");
  const body = await c.req.json();
  const parsed = z.object({ sellerId: z.number(), sellerName: z.string() }).parse(body);
  const updatedBatch = await repo.updateBatch(c.req.param("id"), {
    sellerId: parsed.sellerId,
    sellerName: parsed.sellerName,
    status: "seller_locked",
  });
  await repo.audit("ingestion_batch", existingBatch.id, "seller.locked", actorEmail(c.req.raw), parsed);
  return c.json({ batch: updatedBatch });
});

ingestions.post('/:id/reconcile', async (c) => {
  const repo = new Repository(c.env.DB);
  const batch = await requireBatch(repo, c.req.param("id"));
  requireStatus(batch.status, ["seller_locked"], "Reconcile");
  await repo.audit("ingestion_batch", batch.id, "reconciliation.started", actorEmail(c.req.raw), {
    sellerId: batch.sellerId,
    sellerName: batch.sellerName,
  });
  const candidates = await generateCandidates(c.env, repo, c.req.param("id"));
  return c.json({ candidates });
});

ingestions.post('/:id/finalize-reconciliation', async (c) => {
  const repo = new Repository(c.env.DB);
  const batchId = c.req.param("id");
  const batch = await requireBatch(repo, batchId);
  requireStatus(batch.status, ["reconciliation_in_review"], "Finalize reconciliation");
  const candidates = await repo.listCandidates(batchId);
  if (candidates.length === 0) {
    return c.json({ error: "Run reconciliation before finalizing." }, 400);
  }
  // Auto-park orphan candidates (no source group assigned) — they have no audio and cannot be processed
  const orphans = candidates.filter((c) => !c.sourceGroupKey && !c.classificationDecision);
  for (const orphan of orphans) {
    await repo.updateCandidateDecision(orphan.id, "parked_missing_files", "Auto-parked: no source group assigned");
  }
  const finalCandidates = orphans.length > 0 ? await repo.listCandidates(batchId) : candidates;
  const unresolved = finalCandidates.filter((candidate) => !candidate.classificationDecision || candidate.status !== "reviewed");
  if (unresolved.length > 0) {
    return c.json(
      { error: `All candidates must be resolved before finalizing reconciliation. Remaining: ${unresolved.length}.` },
      400,
    );
  }
  await repo.updateBatch(batchId, { status: "reconciliation_approved" });
  await repo.audit("ingestion_batch", batchId, "reconciliation.approved", actorEmail(c.req.raw), {
    candidateCount: candidates.length,
  });
  return c.json({ ok: true });
});

ingestions.post('/:id/retry-intake', async (c) => {
  const repo = new Repository(c.env.DB);
  try {
    await enqueueDriveIntake(c.env, repo, c.req.param("id"), actorEmail(c.req.raw));
    return c.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "Batch not found") {
      return c.json({ error: error.message }, 404);
    }
    throw error;
  }
});

ingestions.post('/:id/skip-file', async (c) => {
  const repo = new Repository(c.env.DB);
  const batchId = c.req.param("id");
  const batch = await requireBatch(repo, batchId);
  requireStatus(batch.status, ["normalizing"], "Skip file");
  const body = await c.req.json();
  const parsed = z.object({ objectKey: z.string().min(1) }).parse(body);
  const existing = Array.isArray(batch.normalization?.skipRequests) ? batch.normalization.skipRequests.map((value) => String(value)) : [];
  if (!existing.includes(parsed.objectKey)) {
    await repo.updateBatch(batchId, {
      normalization: {
        ...(batch.normalization ?? {}),
        skipRequests: [...existing, parsed.objectKey],
      },
    });
  }
  await repo.audit("ingestion_batch", batchId, "file.skip_requested", actorEmail(c.req.raw), {
    objectKey: parsed.objectKey,
  });
  return c.json({ ok: true });
});

ingestions.get('/:id', async (c) => {
  const repo = new Repository(c.env.DB);
  const [batch, candidates, events] = await Promise.all([
    repo.getBatch(c.req.param("id")),
    repo.listCandidates(c.req.param("id")),
    repo.listAuditEvents("ingestion_batch", c.req.param("id")),
  ]);
  return c.json({ batch, candidates, events });
});

ingestions.get('/:id/stream', async (c) => {
  const repo = new Repository(c.env.DB);
  const batchId = c.req.param("id");
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      let lastPayload = "";

      const write = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      const close = () => {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // no-op
          }
        }
      };

      try {
        write("ready", { batchId });
        const streamStart = Date.now();
        const MAX_STREAM_DURATION = 30 * 60 * 1000; // 30 minutes
        while (!closed && (Date.now() - streamStart < MAX_STREAM_DURATION)) {
          const [batch, candidates, events] = await Promise.all([
            repo.getBatch(batchId),
            repo.listCandidates(batchId),
            repo.listAuditEvents("ingestion_batch", batchId),
          ]);
          const payload = JSON.stringify({ batch, candidates, events });
          if (payload !== lastPayload) {
            lastPayload = payload;
            controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
          } else {
            controller.enqueue(encoder.encode(`event: ping\ndata: {"ok":true}\n\n`));
          }

          if (!batch || !["intake_queued", "normalizing"].includes(batch.status)) {
            await sleep(1000);
          } else {
            await sleep(350);
          }
        }
        if (!closed) close();
      } catch (error) {
        write("error", {
          error: error instanceof Error ? error.message : String(error),
        });
        close();
      }
    },
    cancel() {
      // no-op; stream closes naturally when client disconnects
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      "Connection": "keep-alive",
    },
  });
});

ingestions.post('/:id/approve', async (c) => {
  const repo = new Repository(c.env.DB);
  const batchId = c.req.param("id");
  const batch = await requireBatch(repo, batchId);
  requireStatus(batch.status, ["reconciliation_approved"], "Approve batch");
  await materializeApprovedBooks(repo, c.req.param("id"), actorEmail(c.req.raw));
  await writeIntakeReport(c.env, repo, c.req.param("id"));
  return c.json({ ok: true });
});

ingestions.post('/:id/remap-metadata', async (c) => {
  const repo = new Repository(c.env.DB);
  const body = await c.req.json<{ mapping: Record<string, number | null> }>();
  if (!body?.mapping || typeof body.mapping !== 'object') {
    return c.json({ error: 'mapping object required' }, 400);
  }
  try {
    await remapBatchMetadata(c.env, repo, c.req.param("id"), body.mapping);
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

ingestions.delete('/:id', async (c) => {
  const repo = new Repository(c.env.DB);
  const batch = await repo.getBatch(c.req.param("id"));
  if (!batch) return c.json({ error: "Batch not found" }, 404);
  await repo.deleteBatch(c.req.param("id"));
  return c.json({ ok: true });
});

ingestions.post('/bulk-delete', async (c) => {
  const { ids } = z.object({ ids: z.array(z.string()).min(1) }).parse(await c.req.json());
  const repo = new Repository(c.env.DB);
  await Promise.all(ids.map((id) => repo.deleteBatch(id)));
  return c.json({ ok: true, deleted: ids.length });
});

ingestions.post('/:id/revert', requirePermission('users'), async (c) => {
  const repo = new Repository(c.env.DB);
  const id = c.req.param("id");
  if (!id) return c.json({ error: "Missing batch ID" }, 400);
  try {
    const result = await revertBatch(c.env, repo, id);
    return c.json({ ok: true, ...result });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

export default ingestions;

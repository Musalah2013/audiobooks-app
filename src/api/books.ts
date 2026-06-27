import { getContainer } from '@cloudflare/containers';
import { Hono } from 'hono';
import { z } from 'zod';
import { AudioProcessorContainer } from '../container';
import { Repository } from '../db';
import { buildTrackDrafts, createUploadUrl, generateAudiobookWorkbookBuffer, generateInteractiveSample, revertBook, syncAudiobookToClickUp } from '../pipeline';
import { buildProcessingPayload } from '../processing-contract';
import type { Env, TrackDraft } from '../types';
import { buildCatalogStorageBasePath, keySegments, signInternalArtifactUrl } from '../utils';
import { deriveProductionStage } from '../api-contracts';
import { requirePermission } from './auth';

const books = new Hono<{ Bindings: Env }>();

// Catalog list with unified production stage per title.
books.get('/', async (c) => {
  const repo = new Repository(c.env.DB);
  const [records, linkage] = await Promise.all([
    repo.listAudiobooks(10_000),
    repo.getProductionLinkageByAudiobook(),
  ]);
  const list = records.map((b) => {
    const link = linkage.get(b.id) ?? { assigned: false, sampleState: 'none' as const, delivered: false };
    return {
      id: b.id,
      title: b.title,
      publisherName: b.publisherName,
      processingStatus: b.processingStatus,
      dossierStatus: b.dossierStatus,
      clickupTaskUrl: b.clickupTaskUrl,
      clickupSyncStatus: b.clickupSyncStatus,
      storageBasePath: b.storageBasePath,
      isbn: b.isbn,
      author: b.author,
      narrator: b.narrator,
      totalOriginalSizeBytes: b.totalOriginalSizeBytes,
      productionStage: deriveProductionStage({
        processingStatus: b.processingStatus,
        dossierStatus: b.dossierStatus,
        clickupSyncStatus: b.clickupSyncStatus,
        assigned: link.assigned,
        sampleState: link.sampleState,
        delivered: link.delivered,
      }),
    };
  });
  return c.json({ books: list });
});

function maybeAudioName(name: string) {
  return /\.(mp3|m4a|m4b|wav|flac|aac|ogg)$/i.test(name);
}

function maybeZipName(name: string) {
  return /\.zip$/i.test(name);
}

function stripExtension(name: string) {
  return name.split("/").pop()?.replace(/\.[a-z0-9]+$/i, "") ?? name.replace(/\.[a-z0-9]+$/i, "");
}

async function inspectArchiveTrackDrafts(env: Env, audiobookId: string, apiBaseUrl: string, candidate: NonNullable<Awaited<ReturnType<Repository["listCandidates"]>>[number]>): Promise<TrackDraft[]> {
  const archives = candidate.sourceGroup?.items.filter((item) => maybeZipName(item.name)) ?? [];
  if (archives.length === 0) return [];
  const expiresAt = Date.now() + 60 * 60 * 1000;
  const payload = {
    archives: await Promise.all(
      archives.map(async (archive) => ({
        objectKey: archive.key,
        filename: archive.name,
        downloadUrl: await signInternalArtifactUrl({
          baseUrl: apiBaseUrl,
          path: "/api/internal/artifacts",
          key: archive.key,
          method: "GET",
          secret: env.INTERNAL_API_SECRET,
          expiresAt,
        }),
      })),
    ),
    accessClientId: env.CF_ACCESS_CLIENT_ID,
    accessClientSecret: env.CF_ACCESS_CLIENT_SECRET,
  };
  const container = getContainer<AudioProcessorContainer>(env.AUDIO_PROCESSOR_CONTAINER, audiobookId);
  const response = await container.fetch(
    new Request("http://container/inspect-archive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
  if (!response.ok) {
    throw new Error(`Archive inspection failed: ${response.status}`);
  }
  const parsed = await response.json() as {
    archives?: Array<{
      objectKey: string;
      filename: string;
      entries: Array<{ entryName: string; displayName: string }>;
    }>;
  };
  const drafts = (parsed.archives ?? [])
    .flatMap((archive) =>
      archive.entries
        .filter((entry) => maybeAudioName(entry.entryName))
        .map((entry) => ({
          sourceType: "archive_entry" as const,
          originalObjectKey: archive.objectKey,
          originalFilename: entry.entryName,
          originalDetectedTitle: stripExtension(entry.displayName),
          titleProvenance: "filename" as const,
          proposedTitle: stripExtension(entry.displayName),
        })),
    )
    .sort((left, right) => left.originalFilename.localeCompare(right.originalFilename, undefined, { numeric: true, sensitivity: "base" }))
    .map((draft, index) => ({
      ...draft,
      originalOrderIndex: index + 1,
    }));
  return drafts;
}

books.get('/:id', async (c) => {
  const repo = new Repository(c.env.DB);
  const [book, tracks, processingRuns] = await Promise.all([
    repo.getAudiobook(c.req.param("id")),
    repo.listTracks(c.req.param("id")),
    repo.listProcessingRuns(c.req.param("id")),
  ]);
  const processingRun = processingRuns[0] ?? null;
  const [processingEvents, dossierEvents, productionFiles] = await Promise.all([
    processingRun ? repo.listAuditEvents("processing_run", processingRun.id) : Promise.resolve([]),
    repo.listAuditEvents("audiobook_record", c.req.param("id")),
    book ? repo.listStudioProductionFilesByAudiobook(c.req.param("id")) : Promise.resolve([]),
  ]);
  // Resolve studio names for any studio narrating this title.
  const studioIds = [...new Set(productionFiles.map((f) => f.studio_id))];
  const studioNameById = new Map<string, string>();
  await Promise.all(studioIds.map(async (sid) => {
    const s = await repo.getStudio(sid);
    if (s) studioNameById.set(sid, s.name);
  }));
  const narration = productionFiles.map((f) => ({
    studioId: f.studio_id,
    studioName: studioNameById.get(f.studio_id) ?? null,
    productionFileId: f.id,
    productionFileName: f.name,
  }));
  let productionStage: ReturnType<typeof deriveProductionStage> | null = null;
  if (book) {
    const link = (await repo.getProductionLinkageByAudiobook()).get(book.id) ?? { assigned: false, sampleState: 'none' as const, delivered: false };
    productionStage = deriveProductionStage({
      processingStatus: book.processingStatus,
      dossierStatus: book.dossierStatus,
      clickupSyncStatus: book.clickupSyncStatus,
      assigned: link.assigned,
      sampleState: link.sampleState,
      delivered: link.delivered,
    });
  }
  return c.json({ book, tracks, processingRun, processingEvents, dossierEvents, narration, productionStage });
});

books.post('/:id/prepare-tracks', async (c) => {
  const repo = new Repository(c.env.DB);
  const book = await repo.getAudiobook(c.req.param("id"));
  if (!book) return c.json({ error: "Book not found" }, 404);
  const batch = await repo.getBatch(book.batchId);
  if (!batch || batch.status !== "records_created") {
    return c.json({ error: "Tracks can only be prepared after the batch records are created." }, 400);
  }
  const candidate = book.candidateId ? await repo.getCandidate(book.candidateId) : null;
  if (!batch || !candidate) return c.json({ error: "Missing batch/candidate context" }, 404);
  const requestUrl = new URL(c.req.url);
  const apiBaseUrl = c.env.APP_BASE_URL ?? `${requestUrl.protocol}//${requestUrl.host}`;
  const directAudioItems = candidate.sourceGroup?.items.filter((item) => maybeAudioName(item.name)) ?? [];
  const drafts =
    directAudioItems.length > 0
      ? await buildTrackDrafts(repo, book, candidate)
      : await inspectArchiveTrackDrafts(c.env, book.id, apiBaseUrl, candidate);
  if (drafts.length === 0) {
    return c.json({ error: "No audio tracks could be detected for this candidate." }, 400);
  }
  await repo.replaceTracks(
    book.id,
    drafts.map((draft) => ({
      id: crypto.randomUUID(),
      audiobookId: book.id,
      originalObjectKey: draft.originalObjectKey,
      originalFilename: draft.originalFilename,
      originalDetectedTitle: draft.originalDetectedTitle ?? null,
      originalOrderIndex: draft.originalOrderIndex,
      originalSizeBytes: 0,
      originalDurationSeconds: 0,
      originalBitrateKbps: null,
      originalSampleRateHz: null,
      originalChannels: null,
      finalObjectKey: null,
      finalFilename: `${String(draft.originalOrderIndex).padStart(2, "0")} - ${draft.proposedTitle}.mp3`,
      finalTitle: draft.proposedTitle,
      finalOrderIndex: draft.originalOrderIndex,
      finalSizeBytes: null,
      finalDurationSeconds: null,
      finalBitrateKbps: null,
      finalSampleRateHz: null,
      finalChannels: null,
      titleProvenance: draft.titleProvenance,
      transformationNotes: null,
      approvalStatus: "pending",
    })),
  );
  return c.json({ drafts });
});

books.post('/:id/approve-tracks', async (c) => {
  const repo = new Repository(c.env.DB);
  const book = await repo.getAudiobook(c.req.param("id"));
  if (!book) return c.json({ error: "Book not found" }, 404);
  const existingTracks = await repo.listTracks(book.id);
  if (existingTracks.length === 0) {
    return c.json({ error: "Prepare tracks before approving them." }, 400);
  }
  const body = await c.req.json();
  const parsed = z
    .object({
      tracks: z.array(
        z.object({
          id: z.string(),
          finalTitle: z.string().min(1),
          finalOrderIndex: z.number().int().positive(),
        }),
      ),
    })
    .parse(body);
  const allowedIds = new Set(existingTracks.map((track) => track.id));
  if (!parsed.tracks.every((track) => allowedIds.has(track.id))) {
    return c.json({ error: "Track approval payload includes unknown track ids." }, 400);
  }
  await repo.updateTrackApprovals(c.req.param("id"), parsed.tracks);
  return c.json({ ok: true });
});

books.post('/:id/start-processing', async (c) => {
  const repo = new Repository(c.env.DB);
  const book = await repo.getAudiobook(c.req.param("id"));
  if (!book) return c.json({ error: "Book not found" }, 404);
  const batch = await repo.getBatch(book.batchId);
  const candidate = book.candidateId ? await repo.getCandidate(book.candidateId) : null;
  const tracks = await repo.listTracks(book.id);
  if (!batch || !candidate) return c.json({ error: "Missing book context" }, 404);
  if (!tracks.every((track) => track.approvalStatus === "approved")) {
    return c.json({ error: "Track approval is required before processing." }, 400);
  }
  const processingRunId = crypto.randomUUID();
  const requestUrl = new URL(c.req.url);
  const apiBaseUrl = c.env.APP_BASE_URL ?? `${requestUrl.protocol}//${requestUrl.host}`;
  const payload = await buildProcessingPayload({
    audiobookId: book.id,
    processingRunId,
    publisherId: book.publisherId,
    storageBasePath: book.storageBasePath ?? buildCatalogStorageBasePath({
      publisherId: book.publisherId,
      publisherName: book.publisherName,
      isbn: book.isbn,
      title: book.title,
    }),
    apiBaseUrl,
    internalSecret: c.env.INTERNAL_API_SECRET,
    accessClientId: c.env.CF_ACCESS_CLIENT_ID,
    accessClientSecret: c.env.CF_ACCESS_CLIENT_SECRET,
    approvedTracks: tracks.map((track) => ({
      originalObjectKey: track.originalObjectKey ?? "",
      originalFilename: track.originalFilename,
      originalDetectedTitle: track.originalDetectedTitle ?? undefined,
      originalOrderIndex: track.originalOrderIndex,
      titleProvenance: track.titleProvenance as "metadata_sheet" | "audio_tag" | "filename" | "generated_placeholder",
      proposedTitle: track.finalTitle ?? track.originalDetectedTitle ?? track.originalFilename,
    })),
  });
  await repo.createProcessingRun(processingRunId, book.id, JSON.stringify(payload));
  await repo.updateAudiobook(book.id, { processingStatus: "queued", dossierStatus: "generating" });
  await c.env.PROCESSING_WORKFLOW.create({
    id: processingRunId,
    params: { payload },
  });
  return c.json({ ok: true, processingRunId });
});

books.post('/:id/generate-sample', async (c) => {
  const repo = new Repository(c.env.DB);
  const book = await repo.getAudiobook(c.req.param("id"));
  if (!book) return c.json({ error: "Book not found" }, 404);
  if (book.processingStatus !== "succeeded") {
    return c.json({ error: "Generate the sample only after audio processing succeeds." }, 400);
  }
  const body = await c.req.json();
  const parsed = z.object({
    trackId: z.string().min(1),
    startSeconds: z.number().min(0),
    endSeconds: z.number().positive(),
  }).parse(body);
  const result = await generateInteractiveSample(c.env, repo, book.id, {
    ...parsed,
    actor: "operator",
  });
  return c.json({ ok: true, result });
});

books.post('/:id/finalize-dossier', async (c) => {
  const repo = new Repository(c.env.DB);
  const book = await repo.getAudiobook(c.req.param("id"));
  if (!book) return c.json({ error: "Book not found" }, 404);
  if (book.processingStatus !== "succeeded") {
    return c.json({ error: "Processing must succeed before finalizing the dossier." }, 400);
  }
  if (book.dossierStatus === 'generating') {
    return c.json({ ok: true, status: 'already_generating' });
  }
  const requestUrl = new URL(c.req.url);
  const apiBaseUrl = c.env.APP_BASE_URL ?? `${requestUrl.protocol}//${requestUrl.host}`;
  const workflowId = `dossier-${book.id}-${Date.now()}`;
  await repo.updateAudiobook(book.id, { dossierStatus: 'generating' });
  await c.env.DOSSIER_WORKFLOW.create({ id: workflowId, params: { payload: { audiobookId: book.id, apiBaseUrl } } });
  return c.json({ ok: true, status: 'generating' });
});

books.post('/:id/reset-dossier', requirePermission('users'), async (c) => {
  const repo = new Repository(c.env.DB);
  const id = c.req.param("id");
  if (!id) return c.json({ error: "Missing book ID" }, 400);
  const book = await repo.getAudiobook(id);
  if (!book) return c.json({ error: "Book not found" }, 404);
  if (book.dossierStatus !== 'generating') {
    return c.json({ error: "Only a stuck 'generating' dossier can be reset." }, 400);
  }
  await repo.updateAudiobook(book.id, { dossierStatus: 'failed' });
  return c.json({ ok: true });
});

books.patch('/:id/metadata', async (c) => {
  const repo = new Repository(c.env.DB);
  const book = await repo.getAudiobook(c.req.param("id"));
  if (!book) return c.json({ error: "Book not found" }, 404);
  const body = await c.req.json();
  const parsed = z.object({
    title: z.string().min(1).optional(),
    subtitle: z.string().nullable().optional(),
    author: z.string().nullable().optional(),
    narrator: z.string().nullable().optional(),
    isbn: z.string().nullable().optional(),
    genre: z.string().nullable().optional(),
    blurb: z.string().nullable().optional(),
    pubYear: z.string().nullable().optional(),
    sellingType: z.string().nullable().optional(),
    price: z.number().nullable().optional(),
  }).parse(body);
  await repo.updateAudiobook(c.req.param("id"), parsed);

  // Re-sync to ClickUp if the task already exists and dossier is ready
  if (book.clickupTaskId && book.dossierStatus === 'ready') {
    try {
      await syncAudiobookToClickUp(c.env, repo, c.req.param("id"));
    } catch {
      // Best-effort — don't fail the metadata save if ClickUp sync fails
    }
  }

  return c.json({ ok: true });
});

books.post('/:id/cover', async (c) => {
  const repo = new Repository(c.env.DB);
  const book = await repo.getAudiobook(c.req.param("id"));
  if (!book) return c.json({ error: "Book not found" }, 404);
  const contentType = c.req.header("content-type") ?? "image/jpeg";
  if (!contentType.startsWith("image/")) return c.json({ error: "Only image files are accepted." }, 400);
  const ext = (contentType.split("/")[1]?.split(";")[0] ?? "jpg").replace("jpeg", "jpg");
  const basePath = book.storageBasePath ?? buildCatalogStorageBasePath({
    publisherId: book.publisherId,
    publisherName: book.publisherName,
    isbn: book.isbn,
    title: book.title,
  });
  const coverKey = keySegments(basePath, "cover", `cover.${ext}`);
  if (!c.req.raw.body) return c.json({ error: "Empty body" }, 400);
  await c.env.ASSET_BUCKET.put(coverKey, c.req.raw.body, { httpMetadata: { contentType } });
  await repo.updateAudiobook(c.req.param("id"), { coverObjectKey: coverKey, coverStatus: "uploaded" });
  return c.json({ ok: true, coverObjectKey: coverKey });
});

books.get('/:id/workbook', async (c) => {
  const repo = new Repository(c.env.DB);
  const { buffer, filename } = await generateAudiobookWorkbookBuffer(repo, c.req.param('id'));
  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
});

books.post('/:id/clickup-sync', async (c) => {
  const repo = new Repository(c.env.DB);
  const book = await repo.getAudiobook(c.req.param("id"));
  if (!book) return c.json({ error: "Book not found" }, 404);
  if (book.processingStatus !== "succeeded" || book.dossierStatus !== "ready") {
    return c.json({ error: "ClickUp sync is only allowed after processing succeeds and the dossier is ready." }, 400);
  }
  const body = await c.req.json().catch(() => ({})) as { urgent?: boolean; statusName?: string };
  await syncAudiobookToClickUp(c.env, repo, c.req.param("id"), { urgent: !!body.urgent, statusName: body.statusName || undefined });
  return c.json({ ok: true });
});

async function deleteBookWithR2(env: Env, repo: InstanceType<typeof Repository>, id: string) {
  const book = await repo.getAudiobook(id);
  if (!book) return false;
  if (book.storageBasePath) {
    let cursor: string | undefined;
    do {
      const listed = await env.ASSET_BUCKET.list({ prefix: book.storageBasePath, cursor });
      if (listed.objects.length > 0) {
        await Promise.all(listed.objects.map((o) => env.ASSET_BUCKET.delete(o.key)));
      }
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);
  }
  await repo.deleteAudiobookAndTracks(id);
  return true;
}

books.delete('/:id', requirePermission('users'), async (c) => {
  const repo = new Repository(c.env.DB);
  const id = c.req.param("id");
  if (!id) return c.json({ error: "Missing book ID" }, 400);
  const found = await deleteBookWithR2(c.env, repo, id);
  if (!found) return c.json({ error: "Book not found" }, 404);
  return c.json({ ok: true });
});

books.post('/bulk-delete', requirePermission('users'), async (c) => {
  const { ids } = z.object({ ids: z.array(z.string()).min(1) }).parse(await c.req.json());
  const repo = new Repository(c.env.DB);
  await Promise.all(ids.map((id) => deleteBookWithR2(c.env, repo, id)));
  return c.json({ ok: true, deleted: ids.length });
});

books.post('/:id/reupload-url', async (c) => {
  const repo = new Repository(c.env.DB);
  const book = await repo.getAudiobook(c.req.param("id"));
  if (!book) return c.json({ error: "Book not found" }, 404);
  if (book.processingStatus !== "failed") {
    return c.json({ error: "Reupload is only available for books with failed processing." }, 400);
  }
  const body = await c.req.json();
  const { fileName, contentType } = z.object({ fileName: z.string(), contentType: z.string() }).parse(body);
  if (!/\.zip$/i.test(fileName)) return c.json({ error: "Only ZIP files are accepted for reupload." }, 400);
  const key = keySegments("ingestions", book.batchId, "replacement", book.id, fileName);
  const upload = await createUploadUrl(c.env, key, contentType);
  return c.json({ ...upload, objectKey: key });
});

books.post('/:id/finalize-reupload', async (c) => {
  const repo = new Repository(c.env.DB);
  const book = await repo.getAudiobook(c.req.param("id"));
  if (!book) return c.json({ error: "Book not found" }, 404);
  if (book.processingStatus !== "failed") {
    return c.json({ error: "Reupload is only available for books with failed processing." }, 400);
  }
  const { objectKey } = z.object({ objectKey: z.string() }).parse(await c.req.json());
  const object = await c.env.ASSET_BUCKET.head(objectKey);
  if (!object) return c.json({ error: "Uploaded file not found in storage." }, 404);

  const candidate = book.candidateId ? await repo.getCandidate(book.candidateId) : null;
  if (!candidate) return c.json({ error: "Candidate not found." }, 404);

  const fileName = objectKey.split("/").pop() ?? "book.zip";
  const newSourceGroup = {
    ...(candidate.sourceGroup ?? {}),
    items: [{ key: objectKey, name: fileName, mimeType: "application/zip", sizeBytes: object.size, parentPath: "" }],
    coverCandidates: candidate.sourceGroup?.coverCandidates ?? [],
  };
  await repo.updateCandidateSourceGroup(candidate.id, newSourceGroup.groupKey ?? null, newSourceGroup as Parameters<typeof repo.updateCandidateSourceGroup>[2]);
  await repo.replaceTracks(book.id, []);
  await repo.updateAudiobook(book.id, {
    processingStatus: "pending",
    dossierStatus: "pending",
    dossierWorkbookKey: null,
    dossierAudioZipKey: null,
    sampleTrackId: null,
    sampleStartSeconds: null,
    sampleEndSeconds: null,
    sampleObjectKey: null,
    sampleGeneratedAt: null,
  });
  return c.json({ ok: true });
});

books.post('/:id/revert', requirePermission('users'), async (c) => {
  const repo = new Repository(c.env.DB);
  const id = c.req.param("id");
  if (!id) return c.json({ error: "Missing book ID" }, 400);
  try {
    const result = await revertBook(c.env, repo, id);
    return c.json({ ok: true, ...result });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

export default books;

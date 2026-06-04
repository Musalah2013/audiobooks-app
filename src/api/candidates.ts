import { Hono } from 'hono';
import { z } from 'zod';
import { Repository } from '../db';
import type { Env } from '../types';

const candidates = new Hono<{ Bindings: Env }>();

candidates.post('/:id/decision', async (c) => {
  const repo = new Repository(c.env.DB);
  const candidateId = c.req.param("id");
  const candidate = await repo.getCandidate(candidateId);
  if (!candidate) return c.json({ error: "Candidate not found" }, 404);
  const batch = await repo.getBatch(candidate.batchId);
  if (!batch) return c.json({ error: "Batch not found" }, 404);
  if (batch.status !== "reconciliation_in_review") {
    return c.json(
      { error: `Candidate decisions are only allowed while the batch is in reconciliation_in_review. Current status: ${batch.status}.` },
      400,
    );
  }
  const body = await c.req.json();
  const parsed = z
    .object({
      decision: z.enum([
        "approved_existing",
        "approved_new",
        "parked_missing_files",
        "parked_missing_metadata",
        "parked_needs_business_review",
        "excluded_extra_source",
        "excluded_duplicate_source",
        "excluded_non_book_artifact",
      ]),
      reason: z.string().min(1),
    })
    .parse(body);
  await repo.updateCandidateDecision(candidateId, parsed.decision, parsed.reason);
  return c.json({ ok: true });
});

candidates.patch('/:id/metadata', async (c) => {
  const repo = new Repository(c.env.DB);
  const candidateId = c.req.param("id");
  const candidate = await repo.getCandidate(candidateId);
  if (!candidate) return c.json({ error: "Candidate not found" }, 404);
  const batch = await repo.getBatch(candidate.batchId);
  if (!batch) return c.json({ error: "Batch not found" }, 404);
  const editableStatuses = ["reconciliation_in_review", "metadata_parsed", "seller_locked", "reconciliation_approved", "records_created"];
  if (!editableStatuses.includes(batch.status)) {
    return c.json({ error: `Metadata editing is only allowed before batch approval. Current status: ${batch.status}.` }, 400);
  }

  const body = await c.req.json();
  const parsed = z.object({
    title: z.string().trim().min(1).optional(),
    subtitle: z.string().trim().optional().nullable(),
    author: z.string().trim().optional().nullable(),
    narrator: z.string().trim().optional().nullable(),
    isbn: z.string().trim().optional().nullable(),
    pubYear: z.string().trim().optional().nullable(),
    genre: z.string().trim().optional().nullable(),
    blurb: z.string().trim().optional().nullable(),
    sellingType: z.enum(["subscription", "a_la_carte"]).optional().nullable(),
    price: z.coerce.number().nonnegative().optional().nullable(),
    trackCount: z.coerce.number().int().positive().optional().nullable(),
    importancePoints: z.coerce.number().nonnegative().optional().nullable(),
  }).parse(body);

  const existing = candidate.metadataOverride ?? {};
  const merged: Record<string, unknown> = { ...existing };
  for (const [k, v] of Object.entries(parsed)) {
    if (v === null) {
      delete merged[k];
    } else if (v !== undefined) {
      merged[k] = v;
    }
  }

  await repo.updateCandidateMetadataOverride(candidateId, merged);
  return c.json({ ok: true, metadataOverride: merged });
});

candidates.post('/:id/source-group', async (c) => {
  const repo = new Repository(c.env.DB);
  const candidateId = c.req.param("id");
  const candidate = await repo.getCandidate(candidateId);
  if (!candidate) return c.json({ error: "Candidate not found" }, 404);
  const batch = await repo.getBatch(candidate.batchId);
  if (!batch) return c.json({ error: "Batch not found" }, 404);
  if (batch.status !== "reconciliation_in_review") {
    return c.json(
      { error: `Source-group reassignment is only allowed while the batch is in reconciliation_in_review. Current status: ${batch.status}.` },
      400,
    );
  }
  const body = await c.req.json();
  const parsed = z.object({ sourceGroupKey: z.string().min(1) }).parse(body);
  const groups = Array.isArray(batch.normalization?.groups) ? batch.normalization.groups : [];
  const sourceGroup = groups.find((group) => group?.groupKey === parsed.sourceGroupKey);
  if (!sourceGroup) {
    return c.json({ error: "Detected source group not found in this batch." }, 400);
  }
  await repo.updateCandidateSourceGroup(candidateId, sourceGroup.groupKey, sourceGroup);
  return c.json({ ok: true, sourceGroup });
});

export default candidates;

import { Hono } from 'hono';
import { Repository } from '../db';
import { deriveProductionStage } from '../api-contracts';
import type { Env } from '../types';

const dashboard = new Hono<{ Bindings: Env }>();

async function summarizeRetainedStorage(bucket: R2Bucket) {
  let cursor: string | undefined;
  let retainedBytes = 0;
  let retainedObjects = 0;
  do {
    const listed = await bucket.list({ cursor });
    for (const object of listed.objects) {
      if (object.key.includes('/dossier/')) {
        retainedBytes += object.size;
        retainedObjects += 1;
      }
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  return { retainedBytes, retainedObjects };
}

dashboard.get('/', async (c) => {
  const repo = new Repository(c.env.DB);
  const [batches, rawAudiobooks, retained, linkage] = await Promise.all([
    repo.listBatches(10_000),
    repo.listAudiobooks(10_000),
    summarizeRetainedStorage(c.env.ASSET_BUCKET),
    repo.getProductionLinkageByAudiobook(),
  ]);
  const audiobooks = rawAudiobooks.map((b) => {
    const link = linkage.get(b.id) ?? { assigned: false, sampleState: 'none' as const, delivered: false };
    return { ...b, productionStage: deriveProductionStage({
      processingStatus: b.processingStatus,
      dossierStatus: b.dossierStatus,
      clickupSyncStatus: b.clickupSyncStatus,
      assigned: link.assigned,
      sampleState: link.sampleState,
      delivered: link.delivered,
    }) };
  });

  const batchStatusCounts = batches.reduce<Record<string, number>>((acc, batch) => {
    acc[batch.status] = (acc[batch.status] ?? 0) + 1;
    return acc;
  }, {});

  const processingStatusCounts = audiobooks.reduce<Record<string, number>>((acc, book) => {
    acc[book.processingStatus] = (acc[book.processingStatus] ?? 0) + 1;
    return acc;
  }, {});

  const dossierStatusCounts = audiobooks.reduce<Record<string, number>>((acc, book) => {
    acc[book.dossierStatus] = (acc[book.dossierStatus] ?? 0) + 1;
    return acc;
  }, {});

  const clickupSyncCounts = audiobooks.reduce<Record<string, number>>((acc, book) => {
    acc[book.clickupSyncStatus] = (acc[book.clickupSyncStatus] ?? 0) + 1;
    return acc;
  }, {});

  return c.json({
    batches,
    audiobooks,
    summaries: {
      totalBatches: batches.length,
      totalBooks: audiobooks.length,
      batchStatusCounts,
      processingStatusCounts,
      dossierStatusCounts,
      clickupSyncCounts,
      retainedStorage: retained,
    },
  });
});

export default dashboard;

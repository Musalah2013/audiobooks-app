import { Hono } from 'hono';
import { Repository } from '../db';
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
  const [batches, audiobooks, retained] = await Promise.all([
    repo.listBatches(10_000),
    repo.listAudiobooks(10_000),
    summarizeRetainedStorage(c.env.ASSET_BUCKET),
  ]);

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

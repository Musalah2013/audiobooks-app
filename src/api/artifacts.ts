import { Hono } from 'hono';
import { Repository } from '../db';
import type { Env } from '../types';

const artifacts = new Hono<{ Bindings: Env }>();

artifacts.get('/', async (c) => {
  const repo = new Repository(c.env.DB);
  const audiobookId = c.req.query('audiobookId') ?? undefined;
  const batchId = c.req.query('batchId') ?? undefined;
  const artifactType = c.req.query('artifactType') ?? undefined;
  const items = await repo.listArtifacts({ audiobookId, batchId, artifactType });
  return c.json({ artifacts: items });
});

artifacts.get('/storage', async (c) => {
  const prefix = c.req.query('prefix') ?? '';
  const delimiter = c.req.query('delimiter') ?? '/';
  const listed = await c.env.ASSET_BUCKET.list({ prefix, delimiter });
  return c.json({
    prefix,
    delimiter,
    folders: listed.delimitedPrefixes,
    objects: listed.objects.map((object) => ({
      key: object.key,
      sizeBytes: object.size,
      etag: object.etag,
      uploaded: object.uploaded.toISOString(),
      httpEtag: object.httpEtag,
    })),
    truncated: listed.truncated,
    cursor: ('cursor' in listed ? listed.cursor : null) ?? null,
  });
});

artifacts.get('/analytics', async (c) => {
  let cursor: string | undefined;
  const retainedByPublisher: Record<string, { bytes: number; objects: number }> = {};
  const retainedByType: Record<string, { bytes: number; objects: number }> = {};
  let retainedBytes = 0;
  let retainedObjects = 0;
  let tempBytes = 0;
  let tempObjects = 0;

  do {
    const listed = await c.env.ASSET_BUCKET.list({ cursor });
    for (const object of listed.objects) {
      const parts = object.key.split('/');
      const topLevel = parts[0] ?? 'unknown';
      const artifactClass = object.key.includes('/dossier/')
        ? 'dossier'
        : object.key.startsWith('ingestions/')
          ? 'ingestion'
          : object.key.includes('/artifacts/')
            ? 'transient_artifact'
            : 'other';

      if (artifactClass === 'dossier') {
        retainedBytes += object.size;
        retainedObjects += 1;
        retainedByPublisher[topLevel] ??= { bytes: 0, objects: 0 };
        retainedByPublisher[topLevel].bytes += object.size;
        retainedByPublisher[topLevel].objects += 1;
      } else {
        tempBytes += object.size;
        tempObjects += 1;
      }

      retainedByType[artifactClass] ??= { bytes: 0, objects: 0 };
      retainedByType[artifactClass].bytes += object.size;
      retainedByType[artifactClass].objects += 1;
    }
    cursor = listed.truncated ? (listed as { cursor?: string }).cursor : undefined;
  } while (cursor);

  return c.json({
    retainedBytes,
    retainedObjects,
    tempBytes,
    tempObjects,
    retainedByPublisher,
    retainedByType,
  });
});

export default artifacts;

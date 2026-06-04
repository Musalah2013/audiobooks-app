import { Hono } from 'hono';
import { z } from 'zod';
import { requirePermission } from './auth';
import { Repository } from '../db';
import { DEFAULT_CLICKUP_CONFIG, mergeClickUpConfig } from '../clickup-config';
import type { Env } from '../types';

const settings = new Hono<{ Bindings: Env; Variables: { user: { email: string; role: string } | null } }>();

const R2_PRICING = {
  verifiedAt: '2026-05-12',
  sourceUrl: 'https://developers.cloudflare.com/r2/pricing/',
  standardStorageUsdPerGbMonth: 0.015,
  infrequentAccessStorageUsdPerGbMonth: 0.01,
  classAUsdPerMillion: {
    standard: 4.5,
    infrequentAccess: 9,
  },
  classBUsdPerMillion: {
    standard: 0.36,
    infrequentAccess: 0.9,
  },
  retrievalUsdPerGb: {
    infrequentAccess: 0.01,
  },
  freeTier: {
    storageGbMonth: 10,
    classAOps: 1_000_000,
    classBOps: 10_000_000,
    egress: 'free',
  },
};

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

settings.get('/', async (c) => {
  const retained = await summarizeRetainedStorage(c.env.ASSET_BUCKET);
  const retainedGb = retained.retainedBytes / (1024 ** 3);
  const estimatedMonthlyStorageCostUsd = retainedGb * R2_PRICING.standardStorageUsdPerGbMonth;

  return c.json({
    environment: {
      appEnv: c.env.APP_ENV,
      apiBaseUrl: c.env.APP_BASE_URL ?? null,
      bucketName: c.env.SOURCE_BUCKET_NAME,
    },
    storage: {
      ...retained,
      retainedGb,
      estimatedMonthlyStorageCostUsd,
      estimateType: 'storage_only',
      storageClass: 'standard',
    },
    pricing: R2_PRICING,
  });
});

const clickupConfigSchema = z.object({
  listId: z.string().min(1).optional(),
  statusName: z.string().optional(),
  updateExistingTask: z.boolean().optional(),
  attachCover: z.boolean().optional(),
  fieldMappings: z.record(z.string(), z.string()).optional(),
  descriptionTemplate: z.object({
    includeAppLink: z.boolean().optional(),
    includeWorkbookUrl: z.boolean().optional(),
    includeAudioZipUrl: z.boolean().optional(),
    includeClassification: z.boolean().optional(),
    includeCoverStatus: z.boolean().optional(),
  }).optional(),
});

settings.get('/clickup', async (c) => {
  const repo = new Repository(c.env.DB);
  const [stored, dbToken] = await Promise.all([
    repo.getSetting('clickup'),
    repo.getSetting('clickup_token'),
  ]);
  const config = mergeClickUpConfig(stored ? JSON.parse(stored) : null);
  const activeToken = dbToken ?? c.env.CLICKUP_API_TOKEN ?? null;
  const tokenMasked = activeToken ? `****${activeToken.slice(-4)}` : null;
  const tokenSource: 'db' | 'env' | null = dbToken ? 'db' : (c.env.CLICKUP_API_TOKEN ? 'env' : null);
  return c.json({ config, tokenMasked, tokenSource, defaults: DEFAULT_CLICKUP_CONFIG });
});

settings.patch('/clickup', requirePermission('users'), async (c) => {
  const body = await c.req.json();
  const parsed = clickupConfigSchema.parse(body);
  const repo = new Repository(c.env.DB);
  const stored = await repo.getSetting('clickup');
  const current = mergeClickUpConfig(stored ? JSON.parse(stored) : null);
  const next = mergeClickUpConfig({
    ...current,
    ...parsed,
    fieldMappings: parsed.fieldMappings
      ? { ...current.fieldMappings, ...parsed.fieldMappings }
      : current.fieldMappings,
    descriptionTemplate: parsed.descriptionTemplate
      ? { ...current.descriptionTemplate, ...parsed.descriptionTemplate }
      : current.descriptionTemplate,
  });
  await repo.upsertSetting('clickup', JSON.stringify(next));
  return c.json({ ok: true, config: next });
});

settings.post('/clickup/reset', requirePermission('users'), async (c) => {
  const repo = new Repository(c.env.DB);
  await repo.upsertSetting('clickup', JSON.stringify(DEFAULT_CLICKUP_CONFIG));
  return c.json({ ok: true, config: DEFAULT_CLICKUP_CONFIG });
});

settings.put('/clickup/token', requirePermission('users'), async (c) => {
  const body = await c.req.json();
  const { token: rawToken } = z.object({ token: z.string().min(1) }).parse(body);
  const token = rawToken.trim();
  const repo = new Repository(c.env.DB);
  await repo.upsertSetting('clickup_token', token);
  return c.json({ ok: true, tokenMasked: `****${token.slice(-4)}`, tokenSource: 'db' });
});

settings.delete('/clickup/token', requirePermission('users'), async (c) => {
  const repo = new Repository(c.env.DB);
  await repo.deleteSetting('clickup_token');
  const hasEnvToken = !!c.env.CLICKUP_API_TOKEN;
  const tokenMasked = hasEnvToken ? `****${c.env.CLICKUP_API_TOKEN!.slice(-4)}` : null;
  return c.json({ ok: true, tokenMasked, tokenSource: hasEnvToken ? 'env' : null });
});

settings.get('/clickup/fields', async (c) => {
  const listId = c.req.query('listId');
  if (!listId) return c.json({ error: 'listId query param required' }, 400);

  const repo = new Repository(c.env.DB);
  const dbToken = await repo.getSetting('clickup_token');
  const token = (dbToken ?? c.env.CLICKUP_API_TOKEN ?? '').trim();
  if (!token) return c.json({ error: 'No ClickUp API token configured' }, 400);

  const baseUrl = (c.env.CLICKUP_API_BASE_URL ?? 'https://api.clickup.com/api/v2').replace(/\/$/, '');
  const resp = await fetch(`${baseUrl}/list/${listId}/field`, {
    headers: { Authorization: token },
  });
  if (!resp.ok) {
    const text = await resp.text();
    return c.json({ error: `ClickUp API error ${resp.status}`, detail: text }, resp.status as 400 | 401 | 403 | 404 | 500);
  }
  const payload = await resp.json() as { fields: Array<{ id: string; name: string; type: string }> };
  return c.json({ fields: payload.fields ?? [] });
});

export default settings;

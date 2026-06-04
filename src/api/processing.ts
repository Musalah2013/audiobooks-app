import { Hono } from 'hono';
import { Repository } from '../db';
import type { Env } from '../types';

const processing = new Hono<{ Bindings: Env }>();

processing.get('/runs', async (c) => {
  const repo = new Repository(c.env.DB);
  const audiobookId = c.req.query('audiobookId');
  const runs = await repo.listProcessingRuns(audiobookId);
  return c.json({ runs });
});

processing.get('/runs/:id', async (c) => {
  const repo = new Repository(c.env.DB);
  const runs = await repo.listProcessingRuns();
  const run = runs.find((r) => r.id === c.req.param('id'));
  if (!run) return c.json({ error: 'Not found' }, 404);
  return c.json({ run });
});

export default processing;

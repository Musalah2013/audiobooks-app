import { Hono } from 'hono';
import { searchSamawySellers } from '../integrations';
import type { Env } from '../types';

const sellers = new Hono<{ Bindings: Env }>();

sellers.get('/', async (c) => {
  try {
    const sellers = await searchSamawySellers(c.env, c.req.query("q") ?? "");
    return c.json({ sellers });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err), sellers: [] }, 500);
  }
});

export default sellers;

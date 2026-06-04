# Audiobooks Ops

Cloudflare-orchestrated intake, reconciliation, processing, dossier generation, and ClickUp handoff for audiobook deliveries.

## Stack

- Cloudflare Workers API
- Cloudflare Worker-served frontend assets
- Cloudflare D1
- Cloudflare R2
- Cloudflare Queues
- Cloudflare Workflows
- Cloudflare Containers

## Local commands

```bash
npm install
npm run cf-typegen
npm run db:migrate:local
npm run typecheck
npm test
npm run dev
```

`wrangler dev` requires Docker because the first-pass processing runtime is implemented as a Cloudflare Container backed by `container/Dockerfile`.

## Deployment

Deploy the whole app from the Worker only. The UI is bundled into `ui/dist` and served through the Worker `assets` binding defined in `wrangler.toml`.

```bash
cd ui && npm run build
cd .. && npx wrangler deploy
```

## Real integrations to configure

Set these with `wrangler secret put` or production vars before real use:

- `GOOGLE_DRIVE_ACCESS_TOKEN`
- `CLICKUP_API_TOKEN`
- `SAMAWY_DB_PROXY_BASE_URL`
- `SAMAWY_DB_PROXY_CLIENT_ID`
- `SAMAWY_DB_PROXY_CLIENT_SECRET`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_ACCOUNT_ID`

## Main workflow

1. Create ingestion batch from Drive link or upload.
2. Normalize source into R2.
3. Parse metadata sheet.
4. Lock seller.
5. Generate reconciliation candidates.
6. Approve candidate decisions.
7. Materialize approved audiobooks and export intake report.
8. Prepare and approve tracks.
9. Start container-backed processing workflow.
10. Generate dossier.
11. Sync dossier-ready books to ClickUp.

## Important paths

- Worker API entry: `src/index.ts`
- Workflow: `src/workflows.ts`
- Container runtime: `container/server.mjs`
- Schema: `migrations/0001_initial.sql`
- Thin UI: `ui/src/App.tsx`

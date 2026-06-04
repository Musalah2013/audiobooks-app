# Stack Reference — Audiobooks Ops Platform

Use this document when migrating another project to this stack. It covers every layer, the exact packages and versions in use, the conventions this codebase follows, and the non-obvious decisions made along the way.

---

## Runtime — Cloudflare Workers

Everything runs inside a single Cloudflare Worker. There is no Node.js server, no VPS, no container orchestrator at the top level. The Worker handles HTTP, serves the SPA, runs background jobs, and owns all bindings.

- `wrangler` version: `4.44.0`  
- `compatibility_date`: `2026-05-10`  
- Worker entry: `src/index.ts`
- `@cloudflare/workers-types`: `4.20260510.0`

### Asset serving

The SPA is served from `./ui/dist` via the `[assets]` binding.

```toml
[assets]
directory = "./ui/dist"
binding = "ASSETS"
not_found_handling = "single-page-application"
run_worker_first = true   # CRITICAL — without this, navigation requests bypass the Worker
```

`run_worker_first = true` is mandatory. Without it, Cloudflare's asset layer intercepts browser navigation requests before the Worker runs, so any Worker route that a browser might navigate to directly will return `index.html` instead of the API response.

---

## Web Framework — Hono

```json
"hono": "^4.10.5"
```

Every HTTP route is a Hono app. The main app is created in `src/index.ts` and sub-routers are mounted per domain:

```ts
import { Hono } from 'hono';
const app = new Hono<{ Bindings: Env }>();
app.use('/api/*', authMiddleware);
app.route('/api/books', books);
app.route('/api/files', files);
// ...
// SPA fallback — must be last
app.get('*', async (c) => c.env.ASSETS.fetch(c.req.raw));
export default app;
```

The `Env` interface (in `src/types.ts`) types every binding so they are available on `c.env.*` in every handler.

**Validation**: `zod` (`^4.1.12`) is used directly in route handlers. No schema registry or middleware layer — just inline `.parse(body)`.

---

## Database — Cloudflare D1

D1 is a SQLite-compatible serverless database bound to the Worker.

```toml
[[d1_databases]]
binding = "DB"
database_name = "audiobooks_app_prod_20260510"
database_id = "..."
migrations_dir = "migrations"
```

All queries go through a hand-rolled `Repository` class in `src/db.ts`. No ORM. Queries are raw SQL strings.

```ts
const repo = new Repository(c.env.DB);
const book = await repo.getAudiobook(id);
```

Migrations live in `migrations/` and are applied with:

```bash
npx wrangler d1 migrations apply <db-name> --remote
```

---

## Object Storage — Cloudflare R2

R2 is used for all file storage: source audio, processed tracks, dossier ZIPs, metadata workbooks, covers.

```toml
[[r2_buckets]]
binding = "ASSET_BUCKET"
bucket_name = "audiobooks-ops-prod-20260510"
```

Files are served via `/api/files/*`. That route:
1. Decodes the percent-encoded path with `decodeURIComponent` (R2 keys use raw Unicode, URLs encode Arabic characters)
2. Returns `410` (not `404`) for missing files so the SPA handler doesn't intercept it
3. Detects browser navigation (`Accept: text/html`) and serves a download landing page with a hidden `<iframe>` that triggers the file download without requiring a user gesture

---

## Containers — Cloudflare Containers (Durable Objects)

Long-running audio processing work (ffmpeg, ffprobe, ZIP extraction) runs inside a Docker container bound as a Durable Object.

```toml
[[containers]]
class_name = "AudioProcessorContainer"
image = "./container/Dockerfile"
instance_type = "standard-1"
max_instances = 12

[[durable_objects.bindings]]
name = "AUDIO_PROCESSOR_CONTAINER"
class_name = "AudioProcessorContainer"
```

The container is a plain Node.js HTTP server (`container/server.mjs`). The Worker communicates with it via `container.fetch(new Request(...))`.

```ts
import { getContainer } from '@cloudflare/containers';
const container = getContainer<AudioProcessorContainer>(env.AUDIO_PROCESSOR_CONTAINER, audiobookId);
const response = await container.fetch(new Request('http://container/process', { ... }));
```

The container image is built and pushed automatically during `wrangler deploy`.

### Container authentication

The Worker passes credentials into every container job payload:

```ts
{
  accessClientId: env.CF_ACCESS_CLIENT_ID,
  accessClientSecret: env.CF_ACCESS_CLIENT_SECRET,
}
```

The container adds these to every outbound Worker request:

```js
headers: {
  'CF-Access-Client-Id': payload.accessClientId,
  'CF-Access-Client-Secret': payload.accessClientSecret,
}
```

This is the service-token pattern for bypassing Cloudflare Access (Zero Trust) from machine-to-machine calls.

---

## Workflows — Cloudflare Workflows

Workflows handle long-running, multi-step async jobs (e.g. a full audiobook processing pipeline).

```toml
[[workflows]]
name = "processing-workflow"
binding = "PROCESSING_WORKFLOW"
class_name = "ProcessingWorkflow"
```

A workflow class is exported from `src/workflows.ts` and implements the `WorkflowEntrypoint` interface from `cloudflare:workers`.

```ts
import { WorkflowEntrypoint } from 'cloudflare:workers';
export class ProcessingWorkflow extends WorkflowEntrypoint<Env, Payload> {
  async run(event, step) {
    await step.do('step-name', async () => { ... });
  }
}
```

Workflows are created from a route handler:

```ts
await c.env.PROCESSING_WORKFLOW.create({ id: workflowId, params: { payload } });
```

---

## Queues — Cloudflare Queues

Used for ingest fan-out (one message per source file to process).

```toml
[[queues.producers]]
binding = "INGEST_QUEUE"
queue = "audiobooks-ingest-prod-20260510"

[[queues.consumers]]
queue = "audiobooks-ingest-prod-20260510"
max_batch_size = 10
max_batch_timeout = 5
```

The Worker exports a `queue` handler alongside `fetch`:

```ts
export default { fetch: app.fetch, queue: handleQueue };
```

---

## AI — Workers AI

```toml
[ai]
binding = "AI"
```

Used for metadata column detection from spreadsheets. The model is `@cf/meta/llama-3.1-8b-instruct-fast`.

```ts
const result = await env.AI.run('@cf/meta/llama-3.1-8b-instruct-fast', {
  messages: [...],
  response_format: { type: 'json_object' },
});
```

Note: `response_format: { type: "json_schema" }` is **not supported** by this model. Use `json_object` and parse the output yourself.

---

## Auth

Session-based cookie auth. No third-party auth library. Implementation in `src/api/auth.ts`.

- Login issues a signed session cookie
- `authMiddleware` runs on all `/api/*` routes
- Signed internal artifact URLs bypass auth for `/api/files/` and `/api/internal/artifacts` — verified via HMAC (`INTERNAL_API_SECRET` Worker secret) before the middleware check

Workers secrets (never in `wrangler.toml` `[vars]`):
- `SESSION_SECRET`
- `INTERNAL_API_SECRET`
- `CF_ACCESS_CLIENT_ID`
- `CF_ACCESS_CLIENT_SECRET`

---

## Frontend — React + Vite + Tailwind

The SPA lives in `ui/` as a separate npm workspace.

```
ui/
  src/
    App.tsx              # router, auth guard
    components/
      Layout.tsx         # sidebar shell
    hooks/
      useApi.ts          # GET hook + apiRequest() + downloadFile()
      useLocale.tsx      # AR/EN toggle, persisted in localStorage
    pages/
      Dashboard.tsx
      Books.tsx
      BookDetail.tsx
      Batches.tsx
      BatchDetail.tsx
      Processing.tsx
      Artifacts.tsx
      Analytics.tsx
      Settings.tsx
      Users.tsx
      Login.tsx
  public/
    samawy/
      colors_and_type.css   # design tokens + font imports
      fonts/                # Lama Sans TTF files
      assets/               # logo
```

### Packages

| Package | Version | Purpose |
|---|---|---|
| `react` | `^19.2.5` | UI |
| `react-dom` | `^19.2.5` | DOM renderer |
| `react-router-dom` | `^7.15.0` | Client-side routing |
| `lucide-react` | `^0.460.0` | Icons |
| `vite` | `^8.0.10` | Build tool |
| `tailwindcss` | `^3.4.15` | Styling |
| `typescript` | `~6.0.2` | Type checking |

### Routing

React Router v7. The entire app is wrapped in `<BrowserRouter>` (in `main.tsx`). Routes are defined in `App.tsx`. Auth is checked in the app shell — unauthenticated users are redirected to `/login`.

### API calls

Two utilities in `ui/src/hooks/useApi.ts`:

```ts
// Auto-GET hook, re-runs on refetch()
const { data, loading, error, refetch } = useApi<T>('/api/some-endpoint');

// Any method, imperative
const result = await apiRequest<T>('/api/books/:id/action', {
  method: 'POST',
  body: { ... },
});
```

File downloads use `fetch` → `Blob` → `URL.createObjectURL` → `<a download>` click (works in-app). External download links (ClickUp, email) go through the `/api/files/*` HTML download page.

### Design system

Custom CSS design tokens in `ui/public/samawy/colors_and_type.css`:
- `--samawy-blue`, `--samawy-ink`, `--fg-2`, etc.
- Lama Sans font family (Arabic-first, Latin coverage included)
- RTL-first layout, with `useLocale` switching `document.dir` and `document.lang`

Tailwind is used for spacing, layout, and utility classes. Component classes (`.card`, `.btn-primary`, `.badge-green`, `.sidebar-link`, etc.) are defined in `ui/src/index.css` using `@layer components`.

---

## Project structure

```
/
  src/
    index.ts                  # Worker entry, Hono app, bindings
    types.ts                  # Env interface, domain types, enums
    db.ts                     # Repository class (all D1 queries)
    utils.ts                  # HMAC signing, storage path helpers
    pipeline.ts               # Business logic (batch processing pipeline)
    processing-contract.ts    # Container payload builder
    workflows.ts              # Workflow classes
    integrations.ts           # External API clients (Google Drive, ClickUp, Samawy DB proxy)
    api/
      auth.ts
      books.ts
      ingestions.ts
      candidates.ts
      files.ts
      artifacts.ts
      dashboard.ts
      settings.ts
      internal.ts
  container/
    server.mjs                # Node.js HTTP server (runs inside container)
    package.json
    Dockerfile
  migrations/                 # D1 SQL migrations
  ui/                         # Frontend workspace
  wrangler.toml
  package.json
  tsconfig.json
```

---

## Deployment

```bash
# Build UI + type check
npm run build

# Deploy Worker + container image + assets
npx wrangler deploy
```

`wrangler deploy` handles everything: builds and pushes the container image to Cloudflare's registry, uploads changed static assets, and publishes the Worker bundle in one command.

### Secrets

Set once per environment via:

```bash
npx wrangler secret put SECRET_NAME
```

Never put secret values in `wrangler.toml`. Use `[vars]` only for non-sensitive configuration.

---

## Key non-obvious decisions

| Decision | Reason |
|---|---|
| `run_worker_first = true` in `[assets]` | Without it, Cloudflare's asset layer intercepts browser navigations to non-file paths and serves `index.html`. The Worker never runs for those requests. |
| Return `410` (not `404`) for missing R2 files | `404` is intercepted by `not_found_handling = single-page-application` and returns `index.html`. `410` passes through to the caller. |
| `decodeURIComponent` on R2 key from URL path | R2 keys use raw Unicode. URLs encode Arabic characters as `%D9%8A…`. They must be decoded before the R2 lookup. |
| `redirect: "error"` in container fetches | Prevents Cloudflare Access 302 redirects from silently writing the HTML login page into an `.mp3` file. |
| CF Access Bypass policy for `/api/internal/*` | Containers have no Access session cookie. A Bypass policy on the internal API path lets machine-to-machine calls through; the Worker's own HMAC + `X-Internal-Secret` check still applies. |
| `response_format: json_object` for Workers AI | `json_schema` is unsupported on `llama-3.1-8b-instruct-fast` and throws silently. Always use `json_object` and parse the output manually. |
| `hono` sub-routers per domain | Keeps handlers small and focused. Each domain (books, ingestions, files, etc.) is its own `new Hono()` exported and mounted in `src/index.ts`. |
| Hand-rolled Repository over an ORM | D1 is SQLite. A thin repository class with typed query methods is simpler and more predictable than a full ORM in a Worker context. |
| npm workspaces for UI | The frontend is a separate package (`ui/`) built with Vite. Wrangler picks up `ui/dist` as the assets directory. No separate deploy step needed. |

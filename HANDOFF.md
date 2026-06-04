# Handoff

## Current state

This handoff reflects the current implementation state on `2026-06-04`.

The codebase has been imported into a new standalone GitHub repository:
- https://github.com/Musalah2013/audiobooks-app
- Local repository root: this folder only, not the parent `/Users/musalah/Library/CloudStorage/GoogleDrive-muhammed.salah25@gmail.com/Other computers/My PC/Programming` Git worktree.
- Initial import includes Worker API source, Cloudflare deployment config, D1 migrations, container runtime, frontend React/Vite app, and operational docs.
- Local artifacts were excluded from the published repo via `.gitignore`, including `.playwright-mcp/`, `.DS_Store`, `env-vars.txt`, and `*.xlsx`.

## Repository map

Key source boundaries and deployment layers in this repo:

- `src/index.ts` — Cloudflare Worker entrypoint, Hono router, auth, API routes, and queue handler
- `src/workflows.ts` — Cloudflare Workflow entrypoints for processing and dossier generation
- `src/pipeline.ts` — intake normalization, metadata parsing, batch/report orchestration, and pipeline state transitions
- `src/db.ts` — D1 data access repository using raw SQL and row mapping
- `src/types.ts` — shared application types, API contract imports, and environment bindings
- `src/container.ts` + `container/server.mjs` — Cloudflare Container runtime and Worker<->container integration for audio processing
- `src/api/*` — REST endpoints for dashboard, ingestions, candidates, books, files, settings, and integrations
- `ui/` — React SPA frontend served from `./ui/dist`
- `wrangler.toml` — Cloudflare deployment config for assets, D1, R2, queues, workflows, and containers
- `migrations/` — D1 schema migrations and versioned database setup
- `STACK.md` — stack reference and architectural guidance for the project
- `README.md` — developer startup and deployment commands

## GitHub Action — auto-deploy on push (2026-06-04)

Added `.github/workflows/deploy.yml` that triggers on every push to `main`:
1. Installs dependencies
2. Builds the UI
3. Deploys the Worker via `wrangler deploy`

Requires `CLOUDFLARE_API_TOKEN` secret in GitHub repo settings.

## Latest changes — download links + UI cleanup (2026-05-15)

Now live (Worker version `c63359cd`):

### Download links fixed — root cause resolved

Public/ClickUp download links were showing a blank SPA page instead of downloading the file.

**Root cause**: `[assets]` in `wrangler.toml` was missing `run_worker_first = true`. Without it, Cloudflare's asset layer intercepts browser navigation requests to non-file paths and serves `index.html` directly — the Worker never ran for those requests.

**Fixes applied**:

1. `wrangler.toml` — added `run_worker_first = true` to `[assets]`
2. `src/api/files.ts` — `decodeURIComponent` on the URL path before the R2 key lookup (R2 keys use raw Unicode; Arabic filenames are percent-encoded in URLs)
3. `src/api/files.ts` — returns `410` instead of `404` for missing objects (404 is intercepted by `not_found_handling = single-page-application` and replaced with `index.html`; 410 passes through)
4. `src/api/files.ts` — browser navigation requests (`Accept: text/html`) are served a lightweight HTML download landing page with a hidden `<iframe>` that triggers the actual file download (bypasses Chrome's "no user gesture" restriction for `<a>.click()`)
5. `src/api/files.ts` — `?_dl=1` flag serves the file directly (skips the HTML wrapper); used by the iframe and by programmatic callers

### Batch actions page — added then removed

A `/batch-actions` page was built for running Start Processing, Generate Sample, and ClickUp Sync on multiple books at once. It was removed after review because:
- Start Processing accidentally showed "succeeded" books as eligible, re-queuing them and destroying their state
- The interaction model (pick action tab, select books, run) was too easy to misuse

The correct eligibility gates (documented here for future reference if the feature is revisited):

| Action | Eligible when |
|---|---|
| Start Processing | `processingStatus = pending` or `failed` |
| Generate Sample | `processingStatus = succeeded` AND `dossierStatus = sample_pending` |
| ClickUp Sync | `processingStatus = succeeded` AND `dossierStatus = ready` |

### Stack reference file added

`STACK.md` — a full stack reference document for migrating another project to this codebase's stack (Workers + Hono + D1 + R2 + Containers + React + Vite + Tailwind).

---

## Previous wave — processing pipeline fixes (2026-05-15)

Now live (Worker version `67d66b3c`):

### Root cause resolved: Cloudflare Access blocking container→Worker requests

The entire `samawy-ops.com` domain was protected by Cloudflare Access (Zero Trust). The container had no credentials, so every request it made to the Worker (downloads, uploads, progress callbacks) was 302-redirected to the CF Access login page. Downloads "succeeded" but wrote the HTML login page to disk, causing ffprobe failures on non-audio content. Uploads failed with PUT→GET downgrade.

#### Fix applied

1. **CF Access Bypass application added** (Zero Trust dashboard): A new Access application for `samawy-ops.com/api/internal` with a "Bypass" / Everyone policy. This lets the container reach the Worker's internal API endpoints without Access credentials. Those endpoints remain protected by their own HMAC signature + `X-Internal-Secret` auth at the Worker level.

2. **Service token threading** (code, defence-in-depth): `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` Worker secrets are now threaded into every container payload so the container could authenticate if the Bypass policy were removed:
   - `Env` interface in `src/types.ts`: `CF_ACCESS_CLIENT_ID?`, `CF_ACCESS_CLIENT_SECRET?`
   - `ProcessingJobPayload` and `SampleGenerationPayload` in `src/types.ts`: `accessClientId?`, `accessClientSecret?`
   - `buildProcessingPayload` in `src/processing-contract.ts`: passes creds through
   - `src/api/books.ts`: `buildProcessingPayload` and `inspect-archive` payload now include creds
   - `src/pipeline.ts`: sample generation payload and dossier zip job payload now include creds
   - `container/server.mjs`: `accessHeaders(payload)` helper; threaded into all `downloadToFile`, `uploadFile`, `postProgress`, `postTrackProgress`, and multipart `fetch` calls

3. **Defensive hardening in container**:
   - `downloadToFile` now uses `redirect: "error"` — unexpected redirects throw loudly instead of silently writing an HTML login page into an `.mp3`
   - Full `fetchCauseMessage` error extraction in both download and upload paths
   - `uploadFile` uses Blob body (avoids ArrayBuffer detachment in Node 22 undici)

### Processing audio probe hardened

`probeAudio` in `container/server.mjs` now tries three strategies in sequence:
1. Strict `ffprobe -v error` — fast, works for well-formed files
2. Lenient `ffprobe -v warning -analyzeduration 100M -probesize 100M` — handles files with large ID3 tags or junk before the first sync word
3. `ffmpeg -i` stderr parse — last resort, works when ffprobe can't determine format

### Container error visibility

`workflows.ts` now emits a `container.errors` audit event (visible in the Book detail Log tab) when a processing run completes with errors. Previously, errors were silent in the UI even though the run appeared failed.

### Processed file naming

Output filenames in `executeProcessingJob` are now `${originalOrderIndex.padStart(3, "0")}.mp3` (e.g. `001.mp3`, `002.mp3`). Previously used a verbose original filename.

### Key files changed in this wave

- `src/types.ts`
- `src/processing-contract.ts`
- `src/api/books.ts`
- `src/pipeline.ts`
- `src/workflows.ts`
- `container/server.mjs`

---

## Previous state (2026-05-14)

The app has been substantially reworked locally toward the approved plan:
- Worker-hosted frontend only
- Samawy-branded UI shell and tabbed navigation
- D1 promoted toward canonical catalog/source of truth
- storage naming moved toward `{publisherid_name}/{isbn_title}/...`
- interactive sample selection/generation path added
- settings/storage analytics/cost model added
- full metadata dossier workbook expanded
- ClickUp sync state model added

The app is now live again after the latest deploy, and the most recent hardening wave is included in production.

## Live environment

- Worker/API + frontend: `https://samawy-ops.com`
- Current live Worker version:
  - `39887fc9-e2d9-4235-beda-821afb827ad9`

## What is implemented locally

### 0. Latest wave — operator UX + AI metadata fix (2026-05-13 / 2026-05-14)

Now live (Worker version `39887fc9`):

#### AI metadata column mapping — fixed and working

The AI detection layer in `src/pipeline.ts` was silently falling back to heuristic on every batch because:
- `response_format: { type: "json_schema" }` is unsupported by `@cf/meta/llama-3.1-8b-instruct-fast` — the call threw on every attempt
- The 15-field nested object output format produced nulls on Arabic sheets

Both issues fixed:
- Switched to `response_format: { type: "json_object" }` (the only supported format on that model)
- Rewrote the prompt to request a flat `{"headerRowNumber": N, "mapping": {"A": "title", "B": "author"}}` output (simpler, fewer tokens, easier for the model to produce correctly)
- Now passes the header row **plus 3–4 data rows** to the AI so it can infer from values (ISBN starts with 978, pub year is 4 digits, etc.)
- AI result is merged with heuristic: AI wins where confident, heuristic alias map fills any gaps
- Falls back silently to heuristic only if the AI call actually fails

Supporting changes in `src/pipeline.ts`:
- `aiColumnMappingToInternal(headerRow, mapping)` — converts flat col-letter map to internal 0-based index map
- `detectWorkbookStructureWithAi` fully rewritten
- `extractHeaderCells(rawRows, headerRowNumber)` — builds `{col, index, header}[]` from the detected header row; stored in `metadataNormalizationReport.headerCells`
- `parseBatchMetadata` now stores `rawWorkbookRows` in the normalization JSON so re-mapping never needs to re-run the container
- Added `remapBatchMetadata(env, repo, batchId, newMapping)` — re-derives all `metadataRows` from stored raw rows using a new operator-supplied field→column index mapping

`src/types.ts`:
- Added `headerCells?: Array<{ col: string; index: number; header: string }>` to `MetadataNormalizationReport`

#### Normalization warning doubling — fixed

`normalizeWorkbookRowsWithAi` was merging `detection.warnings + normalized.report.warnings`, but `fallbackNormalizeRows` already copies detection warnings into `report.warnings`. Fixed to only use `report.warnings`.

Also removed the "Used heuristic header detection…" warning from `fallbackHeaderDetection` — it runs as the primary path and the warning was noise.

#### Revert feature — batch and book

Operators can now revert a batch or a book back to the previous pipeline step. All data and files added in the reverted step are deleted.

Backend:
- `revertBatch(env, repo, batchId)` in `src/pipeline.ts` — status-aware, handles every step from `records_created` back to `normalized`. Deletes R2 artifacts and DB records appropriate to the reverted step.
- `revertBook(env, repo, audiobookId)` in `src/pipeline.ts` — reverts a book's processing/dossier state, deletes artifact records, working/target R2 prefixes.
- `deleteR2Prefix(bucket, prefix)` helper added to `src/pipeline.ts`
- `listAudiobooksByBatch(batchId)` and `deleteAudiobookAndTracks(id)` added to `src/db.ts`
- `POST /api/ingestions/:id/revert` in `src/api/ingestions.ts`
- `POST /api/books/:id/revert` in `src/api/books.ts`

Frontend (`ui/src/pages/BatchDetail.tsx`):
- Revert button at the bottom of the Flow Progress card with a confirm/cancel step
- Only shown for statuses where a meaningful revert exists

Frontend (`ui/src/pages/BookDetail.tsx`):
- Revert button in the book header with the same confirm pattern
- Available when dossier is ready/failed/generating, or processing succeeded/failed/running, or tracks exist

#### Bulk actions on Group Matching page

Operators can now select multiple candidates at once and set a decision for all of them in one click.

Changes in `ui/src/pages/BatchDetail.tsx`:
- `selectedCandidates: Set<string>` state
- `bulkSetDecision(decision)` — calls `POST /api/candidates/:id/decision` in parallel for all selected candidates
- Bulk action bar (Existing / New / Park / Exclude) appears above the candidate list when at least one is selected
- Select-all checkbox in the list header
- Per-candidate checkbox on each card; selected cards get an indigo highlight border

#### Column mapping editor

After metadata is parsed, operators can change the field→column mapping without re-running the container.

Backend:
- `POST /api/ingestions/:id/remap-metadata` in `src/api/ingestions.ts` — accepts `{ mapping: Record<string, number | null> }` and calls `remapBatchMetadata`

Frontend (`ui/src/pages/BatchDetail.tsx`):
- Column mapping section in Metadata Snapshot card now has an **Edit mapping** button
- Opens a grid of `<select>` dropdowns, one per mapped field, populated from `metadataReport.headerCells` (e.g. "العنوان (A)", "المؤلف (B)")
- Save calls `POST /api/ingestions/:id/remap-metadata`; Cancel discards changes

#### Collapsible cards

Every major card section in `BatchDetail.tsx` is now collapsible via a `CollapsibleCard` component added before the page export. All default to open. Cards wrapped:
- Flow Progress
- Source Snapshot
- Metadata Snapshot
- Current File Transfers
- Intake Logs
- Metadata Sheet
- Batch Actions
- Batch Events
- Group Matching

Primary files changed in this wave:
- `src/types.ts`
- `src/pipeline.ts`
- `src/db.ts`
- `src/api/ingestions.ts`
- `src/api/books.ts`
- `ui/src/pages/BatchDetail.tsx`
- `ui/src/pages/BookDetail.tsx`

### 0b. Previous live hardening wave

Now live:
- stronger Google Drive link parsing
  - supports `id=` query extraction in addition to `/folders/...`
- explicit inaccessible-folder failure instead of silent `0 files`
- recursive shortcut-aware Drive traversal
  - folder shortcuts are followed
  - file shortcuts are included using their target IDs
- clearer empty/unsupported Drive folder errors
- broader audio-file detection
  - now recognizes `mp3`, `m4a`, `m4b`, `wav`, `flac`, `aac`, `ogg`
- improved normalization grouping
  - top-level subfolder grouping remains
  - multiple root ZIP archives are now split into separate audiobook groups instead of collapsing together
- group-first reconciliation generation
  - metadata rows are assigned uniquely to groups
  - unmatched groups now create their own pending candidates automatically
- large-file Drive copy hardening
  - transient large-file copy failures now retry automatically
  - stalled stream reads are aborted by idle-timeout detection
  - very large batches copy with lower concurrency for stability
  - partial failed destination objects are deleted before retry
- Drive API edge-case hardening
  - Drive listing and metadata access now retry on transient `408/425/429/5xx`
  - Google-native files are no longer treated as downloadable source files
  - copied source object keys now include the Drive file ID, preventing same-name collisions
  - resumed copies only trust existing R2 objects if the expected size matches
- pre-copy Drive staging and AI detection hardening
  - new pre-copy staging preview for Drive folders before batch creation
  - operators can inspect visible files, detected groups, intake mode, and total visible size before intake starts
  - access errors now surface with clearer guidance in the UI
  - workbook AI detection now falls back honestly to heuristics instead of reporting `ai` mode on failed/incomplete mappings
- improved batch operator UX
  - `BatchDetail` now has explicit tabs:
    - `Overview`
    - `Source`
    - `Metadata`
    - `Matching`
    - `Activity`
  - richer blocker messaging
  - richer source-group previews
  - richer unmatched-group visibility

Primary files changed in this wave:
- `src/integrations.ts`
- `src/pipeline.ts`
- `src/utils.ts`
- `src/db.ts`
- `src/api/candidates.ts`
- `ui/src/pages/BatchDetail.tsx`

### 1. Samawy-branded Worker UI

Implemented locally:
- Worker-served frontend only, no Pages architecture
- Samawy shell, logo, Lama Sans font assets, RTL default, blue/ink palette
- top-level workflow tabs:
  - `Dashboard`
  - `New Batch`
  - `Intake`
  - `Metadata`
  - `Matching`
  - `Books`
  - `Processing`
  - `Storage`
  - `Analytics`
  - `Settings`
- rebuilt/updated pages:
  - `ui/src/components/Layout.tsx`
  - `ui/src/pages/Dashboard.tsx`
  - `ui/src/pages/Artifacts.tsx`
  - `ui/src/pages/Analytics.tsx`
  - `ui/src/pages/Settings.tsx`
  - `ui/src/pages/Books.tsx`
  - `ui/src/pages/BookDetail.tsx`
  - `ui/src/pages/Batches.tsx` route-aware intake headings

Design assets copied into:
- `ui/public/samawy/colors_and_type.css`
- `ui/public/samawy/fonts/*`
- `ui/public/samawy/assets/*`

### 2. Catalog hardening in D1

Migration added:
- `migrations/0004_catalog_hardening.sql`

New catalog-oriented fields added to `audiobook_record`:
- `metadata_snapshot_json`
- `storage_base_path`
- `clickup_sync_status`
- `clickup_sync_error`
- `clickup_synced_at`
- `sample_track_id`
- `sample_start_seconds`
- `sample_end_seconds`
- `sample_object_key`
- `sample_generated_at`
- `storage_cleanup_status`
- `storage_cleanup_error`

Repository and types updated accordingly in:
- `src/db.ts`
- `src/types.ts`

### 3. Metadata and dossier expansion

Implemented locally:
- fuller canonical metadata snapshot creation in `src/pipeline.ts`
- dossier workbook now includes broader canonical metadata, not only the narrow row
- workbook sheets expanded:
  - `Summary`
  - `Metadata`
  - `Technical`
  - `Classification`
  - `Validation`
  - `Processing`

### 4. Interactive sample flow

Implemented locally:
- processing no longer auto-generates the final sample
- successful processing now stops at `sample_pending`
- operator-driven sample generation path added

Backend:
- `POST /api/books/:id/generate-sample`
- `POST /api/books/:id/finalize-dossier`

Container:
- `/generate-sample` route added to trim a selected processed track with `ffmpeg`

Frontend:
- `ui/src/pages/BookDetail.tsx` now has a dedicated sample tab:
  - choose processed track
  - preview audio
  - enter start/end seconds
  - generate sample
  - preview/download generated sample

### 5. Storage browser and analytics

Implemented locally:
- `GET /api/artifacts/storage`
- `GET /api/artifacts/analytics`
- storage browser UI in `ui/src/pages/Artifacts.tsx`
- analytics UI in `ui/src/pages/Analytics.tsx`

All operator-facing sizes were moved to human units:
- MB / GB in UI
- raw bytes retained internally only

### 6. Settings page and Cloudflare R2 pricing

Implemented locally:
- `GET /api/settings`
- storage-only cost estimate
- official R2 pricing reference included

Pricing constants embedded from Cloudflare docs, verified on:
- `2026-05-12`
- source: `https://developers.cloudflare.com/r2/pricing/`

### 7. ClickUp sync repair

Implemented locally:
- absolute app links via `APP_BASE_URL`
- explicit sync states:
  - `never_synced`
  - `syncing`
  - `synced`
  - `failed`
- sync error/timestamp persisted on audiobook record
- `Length (Hours)` mapping fixed to use hours, not minutes

### 8. Storage cleanup logic

Implemented locally:
- final retained storage under `storage_base_path/dossier/...`
- cleanup helpers added to remove temp/intermediate data after dossier finalization:
  - `cleanupAudiobookStorage(...)`
  - `cleanupBatchStorageIfTerminal(...)`

Important: this logic is implemented locally, but not yet fully live-verified after this latest wave.

## Fresh dev environment status

### D1

The dev D1 database **was successfully wiped**.

Verified counts after reset:
- `ingestion_batch = 0`
- `ingestion_candidate = 0`
- `audiobook_record = 0`
- `artifact_record = 0`
- `audit_event = 0`

Database:
- `audiobooks_app_dev_20260510`
- id: `27902086-99da-4d5c-bd5b-01218c4f7989`

### R2

The original dev bucket:
- `audiobooks-ops-dev-20260510`

could **not** be emptied in place because:
- bucket deletion is blocked while non-empty
- direct Worker-based dev reset/listing through `wrangler dev --remote` kept failing with Cloudflare `1105`
- direct API access to `api.cloudflare.com` from this environment was timing out intermittently

Pragmatic workaround completed:
- **new empty dev bucket created:** `audiobooks-ops-dev-20260512`
- local `wrangler.toml` now points dev `ASSET_BUCKET` and `SOURCE_BUCKET_NAME` to that new empty bucket

So the app’s **intended dev storage target is now fresh**, even though the old bucket still exists orphaned in the account.

## Local verification status

Verified successfully from the local `/tmp` mirror:
- `npx tsc -p tsconfig.json --noEmit`
- `cd ui && npx tsc -b`
- `cd ui && npm run build`

The Drive-mounted workspace still causes hanging behavior for longer TypeScript/build/Wrangler runs, so all reliable verification/deploy work should continue from:
- `/tmp/audiobooks-app-deploy`

## Deploy status

Latest local changes in the most recent hardening wave **are deployed live**.

Verified:
- `GET /api/health` returns `ok: true`
- Worker-served frontend bundle is live and serving:
  - `/assets/index-Dokipc82.js`
  - `/assets/index-CX7AsHFx.css`

Deployment note:
- Wrangler output was mostly silent during the final deploy, but the Cloudflare debug logs confirm asset upload and final version publication.

## Important fixes made in this pass

### Auth partial-update bug fixed locally

Fixed in `src/api/auth.ts`:
- `PATCH /api/auth/users/:email` now preserves existing `role` and `isActive` when omitted
- no longer silently demotes users to `ops_specialist`
- now returns `404` if the target user does not exist

### Dev reset route improved locally

Updated `src/api/settings.ts`:
- chunked R2 deletions instead of one giant `Promise.all`
- returns explicit error payload on failure
- no longer writes a fresh audit row after reset
- clears `sqlite_sequence`

Note: despite the code improvement, `wrangler dev --remote` was still returning Cloudflare `1105` for Worker routes in this environment, so infra-level reset was completed by:
- wiping D1 directly
- switching app config to a brand new dev bucket

### CSS import warning reduced

In `ui/public/samawy/colors_and_type.css`:
- moved Google font `@import` lines above `@font-face`

## Key files changed in the latest implementation wave

- `migrations/0004_catalog_hardening.sql`
- `src/types.ts`
- `src/utils.ts`
- `src/db.ts`
- `src/clickup-fields.ts`
- `src/processing-contract.ts`
- `src/workflows.ts`
- `src/pipeline.ts`
- `src/api/books.ts`
- `src/api/dashboard.ts`
- `src/api/artifacts.ts`
- `src/api/settings.ts`
- `src/api/files.ts`
- `src/api/auth.ts`
- `src/index.ts`
- `container/server.mjs`
- `wrangler.toml`
- `ui/src/index.css`
- `ui/src/components/Layout.tsx`
- `ui/src/App.tsx`
- `ui/src/pages/Dashboard.tsx`
- `ui/src/pages/Artifacts.tsx`
- `ui/src/pages/Analytics.tsx`
- `ui/src/pages/Settings.tsx`
- `ui/src/pages/Books.tsx`
- `ui/src/pages/BookDetail.tsx`
- `ui/src/pages/Batches.tsx`

## Current dev resource targets in source

Worker config now points dev to:
- D1: `audiobooks_app_dev_20260510`
- R2: `audiobooks-ops-dev-20260512`

Production config remains:
- D1: `audiobooks_app_prod_20260510`
- R2: `audiobooks-ops-prod-20260510`

## What still needs to be done next

1. **Live-verify the new operator features**
   - Bulk candidate decisions work end-to-end on a real reconciliation batch
   - Revert batch steps correctly delete R2 data at each status transition
   - Revert book removes processing artifacts and resets status
   - Column mapping editor saves and the metadata rows update correctly
   - Collapsible cards open/close without layout breakage

2. **Detail page localization second pass**
   - `BatchDetail.tsx` and `BookDetail.tsx` have partial Arabic/English coverage
   - A full localization pass is still needed for all remaining Arabic-only strings in both pages

3. **Eventually clean up the orphaned old dev bucket**
   - old bucket still present: `audiobooks-ops-dev-20260510`
   - no longer blocking dev testing; Worker config points to `audiobooks-ops-dev-20260512`

## Fixes applied on 2026-05-12

### Batches page blank-screen bug fixed

Fixed in `ui/src/pages/Batches.tsx`:
- `useMemo` for `pageCopy` was placed after the `if (loading)` and `if (error)` early returns, violating the Rules of Hooks.
- On first render `loading=true` → early return, `useMemo` not called. On second render data arrived → `useMemo` reached for the first time → React threw on the inconsistent hook count → whole app unmounted (blank page).
- Fix: moved `useMemo` above both early returns. Loading/error guards now follow it.
- Affected all tabs that render `<Batches />`: `/new-batch`, `/intake`, `/metadata`, `/matching`, `/batches`.

### English UI layer added

Implemented a persistent Arabic/English layer for the main Worker-hosted app shell.

Files added/updated:
- `ui/src/hooks/useLocale.tsx`
- `ui/src/main.tsx`
- `ui/src/components/Layout.tsx`
- `ui/src/pages/Dashboard.tsx`
- `ui/src/pages/Batches.tsx`
- `ui/src/pages/Books.tsx`
- `ui/src/pages/Artifacts.tsx`
- `ui/src/pages/Analytics.tsx`
- `ui/src/pages/Settings.tsx`
- `ui/src/pages/Processing.tsx`
- `ui/src/pages/ProcessingLogs.tsx`

Behavior:
- top-right `EN` / `AR` switch in the header
- selection persists in `localStorage` under `samawy-ui-locale`
- document `lang` and `dir` switch between `ar/rtl` and `en/ltr`
- main navigation and major top-level workflow pages now render English copy when switched to `EN`

Live verification completed after deploy:
- Worker version: `f20bab13-477e-425b-872e-afbcd220dc8c`
- `EN` toggle works on the live Worker app
- verified text switches on `/`, and shell/navigation become English

Known remaining gap:
- detail pages like `BatchDetail` and `BookDetail` are still primarily Arabic and need a second localization pass

## Notes

- Direct unauthenticated `curl` to the public Worker URL is still blocked by Cloudflare Access.
- `wrangler dev --remote` in this environment is unreliable for actual route verification; it starts, but local route calls often return Cloudflare `1105`.
- Use `/tmp/audiobooks-app-deploy` for all future build/deploy attempts.

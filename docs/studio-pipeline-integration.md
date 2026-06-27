# Design: Linking the Studio Flow to the Core Pipeline

**Status:** Proposal (not yet implemented)
**Author:** Engineering
**Decision captured:** Studios are **independent / shared** — a studio may narrate books for *any* publisher (studio ↔ publisher is many-to-many). Studios are NOT the same entity as publishers/sellers.

---

## 1. Problem

The app currently contains two object graphs that never reference each other:

```
CORE PIPELINE
  ingestion_batch → ingestion_candidate → audiobook_record (owned by publisher / seller_id)
                  → processing_run → dossier → ClickUp sync

STUDIO ISLAND
  studio → studio_production_file   (books handed to the studio to narrate)
         → studio_sample            (narration auditions; links only to studio_production_file.book_id)
         → studio_drive_upload      (finished audio delivered to the studio's Drive folder)
```

The **only** existing cross-link is `studio_sample.book_id → studio_production_file.id` (migration `0010`).
There is no foreign key between any studio object and `audiobook_record`, `ingestion_batch`, or a publisher.

**Consequence:** the production loop is closed *manually*. A studio delivers narrated audio to a Drive
folder; an operator then separately creates an intake batch pointing at that folder. Nothing in the data
ties the delivery to the catalog title it fulfills, so there is no single place to answer
"where is title X across its entire lifecycle?" or "what is studio Y currently producing?".

---

## 2. Conceptual model

The studio is the **narration vendor** in the value chain. The intended end-to-end thread:

```
Operator assigns a catalog title to a studio
  → studio uploads a sample        → operator approves / refuses
  → studio narrates & delivers audio (Drive upload)
  → delivery auto-creates / attaches an intake batch
  → core pipeline processes → dossier → ClickUp
```

Because studios are **independent**, a studio is not owned by a publisher. Instead, each *assignment*
(a production file / catalog title given to a studio) is the thing that carries the publisher context —
the title already knows its publisher via `audiobook_record.publisher_id`.

---

## 3. The missing edges

| # | New link | Direction | Enables |
|---|----------|-----------|---------|
| 1 | `studio_production_file.audiobook_id` → `audiobook_record.id` | assignment | "This studio is producing *this catalog title*." Anchors samples & deliveries to a real title; lets a book show its narration status. |
| 2 | `studio_drive_upload.batch_id` → `ingestion_batch.id` | delivery → intake | A studio delivery auto-spawns or attaches an intake batch. Closes the loop end-to-end. |
| 3 | `studio_assignment` join table (optional) | studio ↔ title | Clean many-to-many record of who is producing what, with assignment status/history, instead of overloading `studio_production_file`. |

Note: because the relationship is many-to-many and independent, we deliberately do **not** add
`studio.publisher_id`. Publisher context flows through the assigned title, not through the studio.

---

## 4. Recommended increments (lowest risk first)

### Step 1 — Navigation + read-only cross-links (no schema change)
- On operator **BookDetail**, show "Narrated by: {studio}" when a correlation exists (match on title/ISBN until FKs land).
- On **StudioManage**, show each production file's downstream catalog + processing status.
- Payoff: the two halves immediately *feel* connected; zero migration risk.

### Step 2 — Explicit assignment (`audiobook_id` on `studio_production_file`)
- One nullable column + index.
- Add an "Assign to studio" action (from BookDetail, or a catalog picker in StudioManage).
- Samples and deliveries now anchor to a real catalog title.
- BookDetail can surface narration status: `sample pending → approved → audio delivered`.
- **Build this first** once we move from plan to code — everything else depends on it.

### Step 3 — Auto-bridge delivery → intake (`batch_id` on `studio_drive_upload`)
- When the `studio-drive-sync` queue handler completes a studio upload, create a `draft` ingestion
  batch pre-pointed at that studio's Drive folder and link it back via `batch_id`.
- Replace (or augment) the current "new file" operator email with a **"Review delivered audio"** CTA
  that drops the operator straight into the existing intake flow — no manual batch creation.
- Highest automation value; depends on Step 2 for the title linkage.

### Step 4 — Unified production-status surface
- Derive a single status spanning both graphs:
  `assigned → sample_review → narrating → delivered → processing → dossier → synced`.
- Show it on the Dashboard, BookDetail, and StudioManage so one glance locates any title across the
  full chain.

---

## 5. Routing / UX notes

- **Keep the external studio portal (`/studio/:slug`) a separate island by design.** Narration vendors
  must not see the operator app, the catalog, or other studios. The linkage is for the *operator's*
  experience, not the studio's.
- The studio portal can still *gain* title context: once Step 2 lands, a delivered upload / submitted
  sample can show the catalog title name it fulfills (read-only) without exposing anything else.
- For operators, the integration is mostly about **cross-navigation and unified status**, since they
  already reach both `Studios` and the catalog from the main nav.

---

## 6. Open questions before implementation

1. **Assignment granularity** — does a studio get assigned a whole catalog *title*, or a specific
   production file (e.g. a manuscript PDF)? This decides whether the FK lives on
   `studio_production_file` or a dedicated `studio_assignment` table.
2. **Delivery → batch mapping** — is each Drive upload one book (1:1 batch), or can a studio deliver a
   multi-book folder (1:many)? Affects whether Step 3 creates one batch per upload or one per folder sweep.
3. **Sample gating** — should "audio delivery" be blocked until a sample is approved, or are they
   independent? Determines whether the unified status is strictly sequential.

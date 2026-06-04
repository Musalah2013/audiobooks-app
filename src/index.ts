import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env, QueueMessage } from "./types";
import { Repository } from "./db";
import { normalizeDriveIntake, normalizeUploadedBatch, parseBatchMetadata, writeIntakeReport } from "./pipeline";
import { DossierWorkflow, ProcessingWorkflow, runProcessingPipeline } from "./workflows";
import { AudioProcessorContainer } from "./container";
import { nowIso } from "./utils";

// API modules
import dashboard from "./api/dashboard";
import sellers from "./api/sellers";
import ingestions from "./api/ingestions";
import candidates from "./api/candidates";
import books from "./api/books";
import files from "./api/files";
import internal from "./api/internal";
import processing from "./api/processing";
import artifacts from "./api/artifacts";
import settings from "./api/settings";
import auth, { authMiddleware } from "./api/auth";
import studioAuth from "./api/studio-auth";
import acquisitionAuth from "./api/acquisition-auth";
import studios from "./api/studios";
import studioPortal from "./api/studio-portal";
import acquisitionPortal from "./api/acquisition-portal";
import { uploadFileToDrive } from "./integrations";

const app = new Hono<{ Bindings: Env }>();

// Global error handler — always return JSON so clients can parse the message
app.onError((err, c) => {
  console.error(`[${c.req.method}] ${c.req.url}:`, err);
  return c.json({ error: err.message || "Internal server error" }, 500);
});

// CORS — allow credentials so cookies are sent cross-origin/subdomain
app.use("/api/*", cors({ credentials: true }));
app.use("/api/*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  c.header("Pragma", "no-cache");
});

// Health check (public)
app.get("/api/health", (c) =>
  c.json({
    ok: true,
    env: c.env.APP_ENV,
    time: nowIso(),
  }),
);

// Auth routes (public — before authMiddleware)
app.route("/api/auth", auth);
app.route("/api/studio-auth", studioAuth);
app.route("/api/acquisition-auth", acquisitionAuth);

// Apply auth middleware to all other API routes
app.use("/api/*", authMiddleware);

// Mount API routes
app.route("/api/dashboard", dashboard);
app.route("/api/sellers", sellers);
app.route("/api/ingestions", ingestions);
app.route("/api/candidates", candidates);
app.route("/api/books", books);
app.route("/api/files", files);
app.route("/api/internal", internal);
app.route("/api/processing", processing);
app.route("/api/artifacts", artifacts);
app.route("/api/settings", settings);
app.route("/api/studios", studios);
app.route("/api/studio-portal", studioPortal);
app.route("/api/acquisition-portal", acquisitionPortal);

// Local upload endpoint (not in a module because it's a catch-all path)
app.put("/api/local-upload/:key{.+}", async (c) => {
  const key = decodeURIComponent(c.req.param("key"));
  const body = await c.req.raw.arrayBuffer();
  await c.env.ASSET_BUCKET.put(key, body, {
    httpMetadata: { contentType: c.req.header("content-type") ?? "application/octet-stream" },
  });
  return c.json({ ok: true, key });
});

// SPA fallback for Worker-served frontend assets
app.get("*", async (c) => c.env.ASSETS.fetch(c.req.raw));

// Queue handler
const queueHandler = async (batch: MessageBatch<unknown>, env: Env) => {
  const repo = new Repository(env.DB);
  for (const message of batch.messages) {
    // Drive sync messages from the studio-drive-sync-prod queue
    const rawPayload = message.body as Record<string, unknown>;
    if (rawPayload && typeof rawPayload === "object" && "driveUploadId" in rawPayload) {
      const driveUploadId = rawPayload.driveUploadId as string;
      try {
        const upload = await repo.getDriveUpload(driveUploadId);
        if (!upload) { message.ack(); continue; }
        const studio = await repo.getStudio(upload.studio_id);
        if (!studio?.drive_folder_id) {
          await repo.updateDriveUpload(driveUploadId, { status: "failed", error: "Studio has no Drive folder configured." });
          message.ack(); continue;
        }
        await repo.updateDriveUpload(driveUploadId, { status: "uploading" });
        const r2Object = await env.ASSET_BUCKET.get(upload.object_key);
        if (!r2Object) {
          await repo.updateDriveUpload(driveUploadId, { status: "failed", error: "R2 object not found." });
          message.ack(); continue;
        }
        const fileData = await r2Object.arrayBuffer();
        const mimeType = r2Object.httpMetadata?.contentType ?? "application/octet-stream";
        const driveFile = await uploadFileToDrive(env, studio.drive_folder_id, upload.name, fileData, mimeType);
        await repo.updateDriveUpload(driveUploadId, { status: "completed", driveFileId: driveFile.id });
        message.ack();
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        await repo.updateDriveUpload(driveUploadId, { status: "failed", error: msg }).catch(() => {});
        message.ack();
      }
      continue;
    }

    const payload = message.body as QueueMessage;
    try {
      if (payload.type === "drive-intake") {
        await repo.updateBatch(payload.batchId, { status: "normalizing" });
        await normalizeDriveIntake(env, repo, payload.batchId);
      } else if (payload.type === "upload-intake") {
        const batchRecord = await repo.getBatch(payload.batchId);
        if (!batchRecord) {
          throw new Error(`Upload batch not found: ${payload.batchId}`);
        }
        await repo.updateBatch(payload.batchId, { status: "normalizing" });
        await normalizeUploadedBatch(env, repo, batchRecord, payload.manifest);
      } else if (payload.type === "metadata-parse") {
        await parseBatchMetadata(env, repo, payload.batchId);
      } else if (payload.type === "build-intake-report") {
        await writeIntakeReport(env, repo, payload.batchId);
      }
      message.ack();
    } catch (error) {
      console.error(`Queue job failed for ${payload.type}:`, error);
      if (payload.type === "drive-intake" || payload.type === "upload-intake") {
        const current = await repo.getBatch(payload.batchId);
        if (current) {
          await repo.updateBatch(payload.batchId, {
            status: "intake_failed",
            normalization: {
              ...(current.normalization ?? {}),
              intakeError: error instanceof Error ? error.message : String(error),
            },
          });
        }
      } else if (payload.type === "metadata-parse") {
        const current = await repo.getBatch(payload.batchId);
        if (current) {
          await repo.updateBatch(payload.batchId, {
            status: "metadata_sheet_selected",
            normalization: {
              ...(current.normalization ?? {}),
              metadataParseError: error instanceof Error ? error.message : String(error),
            },
          });
          await repo.audit("ingestion_batch", payload.batchId, "metadata.parse.failed", "system", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      message.ack();
    }
  }
};

export default {
  fetch: app.fetch,
  queue: queueHandler,
} satisfies ExportedHandler<Env>;

export { AudioProcessorContainer, ProcessingWorkflow, DossierWorkflow };

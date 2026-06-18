import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env, QueueMessage } from "./types";
import { Repository } from "./db";
import { IntakeCheckpointError, normalizeDriveIntake, normalizeUploadedBatch, parseBatchMetadata, writeIntakeReport } from "./pipeline";
import { DossierWorkflow, ProcessingWorkflow, runProcessingPipeline } from "./workflows";
import { AudioProcessorContainer } from "./container";
import { nowIso, extractDriveFolderId } from "./utils";
import { sendEmail, driveUploadCompleteEmail } from "./email";

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
        if (!studio?.drive_folder_id?.trim()) {
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
        const folderId = extractDriveFolderId(studio.drive_folder_id) ?? studio.drive_folder_id;
        console.log(`[drive-sync] Uploading ${upload.name} to Drive folder ${folderId} for studio ${studio.name}`);
        const driveFile = await uploadFileToDrive(env, folderId, upload.name, fileData, mimeType);
        console.log(`[drive-sync] Upload succeeded: ${driveFile.id}`);
        await repo.updateDriveUpload(driveUploadId, { status: "completed", driveFileId: driveFile.id });
        if (env.EMAIL && studio.contact_email) {
          await sendEmail({
            to: studio.contact_email,
            toName: studio.name,
            subject: `تم رفع الملف "${upload.name}" إلى Google Drive`,
            html: driveUploadCompleteEmail(upload.name, studio.name, driveFile.id),
            emailBinding: env.EMAIL,
          }).catch(() => {});
        }
        message.ack();
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[drive-sync] Upload failed for ${driveUploadId}:`, msg);
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
        // Intake is resumable: copied files are already persisted in R2 and the
        // normalizer skips them on the next attempt. So instead of failing hard,
        // redeliver the message until the work completes or we exhaust attempts.
        // A time-budget checkpoint (IntakeCheckpointError) is an expected pause,
        // not a real failure, so it never counts toward the failure ceiling.
        const isCheckpoint = error instanceof IntakeCheckpointError;
        const MAX_INTAKE_ATTEMPTS = 8;
        if (isCheckpoint || message.attempts < MAX_INTAKE_ATTEMPTS) {
          const delaySeconds = isCheckpoint ? 1 : Math.min(60, 2 ** message.attempts);
          console.warn(
            `Intake ${payload.type} for ${payload.batchId} will resume (attempt ${message.attempts}, checkpoint=${isCheckpoint}).`,
          );
          message.retry({ delaySeconds });
          continue;
        }
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

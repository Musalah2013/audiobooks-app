import { getContainer } from "@cloudflare/containers";
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { Repository } from "./db";
import { AudioProcessorContainer } from "./container";
import { finalizeAudiobookDossier, recordProcessingResult } from "./pipeline";
import type { Env, ProcessingJobPayload, ProcessingJobResult } from "./types";
import { nowIso } from "./utils";

export interface DossierJobPayload {
  audiobookId: string;
  apiBaseUrl: string;
}

export async function runProcessingPipeline(env: Env, payload: ProcessingJobPayload) {
  const repo = new Repository(env.DB);
  await repo.updateProcessingRun(payload.processingRunId, { status: "running" });
  await repo.updateAudiobook(payload.audiobookId, { processingStatus: "running", dossierStatus: "generating" });
  await repo.audit("processing_run", payload.processingRunId, "workflow.started", "workflow", {
    startedAt: nowIso(),
  });

  const container = getContainer<AudioProcessorContainer>(env.AUDIO_PROCESSOR_CONTAINER, payload.audiobookId);

  // Check if the job is already running before (re-)starting it — avoids duplicate starts on CF Workflow retries
  const existingJobResponse = await container.fetch(new Request(`http://container/jobs/${payload.processingRunId}`));
  const existingJob = existingJobResponse.ok
    ? ((await existingJobResponse.json()) as { status?: string; result?: ProcessingJobResult | null; error?: string | null })
    : null;

  let jobId = payload.processingRunId;

  if (!existingJob || (existingJob.status !== "running" && existingJob.status !== "completed")) {
    const startResponse = await container.fetch(
      new Request("http://container/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );
    if (!startResponse.ok) {
      const error = `Container processing failed to start: ${startResponse.status}`;
      await repo.updateProcessingRun(payload.processingRunId, { status: "failed_retryable", error });
      await repo.updateAudiobook(payload.audiobookId, { processingStatus: "failed", dossierStatus: "failed" });
      await repo.audit("processing_run", payload.processingRunId, "container.failed", "workflow", {
        error,
        failedAt: nowIso(),
      });
      throw new Error(error);
    }
    const startPayload = (await startResponse.json()) as { jobId?: string };
    jobId = startPayload.jobId ?? payload.processingRunId;
  } else if (existingJob.status === "completed" && existingJob.result) {
    // Job already completed on a prior attempt — skip polling and go straight to result handling
    jobId = payload.processingRunId;
  }

  let result: ProcessingJobResult | null = existingJob?.status === "completed" ? (existingJob.result ?? null) : null;
  for (let attempt = 0; attempt < 900 && !result; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const statusResponse = await container.fetch(new Request(`http://container/jobs/${jobId}`));
    if (!statusResponse.ok) {
      continue;
    }
    const jobState = (await statusResponse.json()) as {
      status?: string;
      result?: ProcessingJobResult | null;
      error?: string | null;
    };
    if (jobState.status === "completed" && jobState.result) {
      result = jobState.result;
      break;
    }
    if (jobState.status === "failed") {
      const error = jobState.error ?? "Container processing job failed.";
      await repo.updateProcessingRun(payload.processingRunId, { status: "failed_retryable", error });
      await repo.updateAudiobook(payload.audiobookId, { processingStatus: "failed", dossierStatus: "failed" });
      await repo.audit("processing_run", payload.processingRunId, "container.failed", "workflow", {
        error,
        failedAt: nowIso(),
      });
      throw new Error(error);
    }
  }
  if (!result) {
    const error = "Container processing timed out before completion.";
    await repo.updateProcessingRun(payload.processingRunId, { status: "failed_retryable", error });
    // Keep audiobook in "running" state — CF Workflow will retry this step and the container will resume
    await repo.audit("processing_run", payload.processingRunId, "container.timeout", "workflow", {
      error,
      timedOutAt: nowIso(),
    });
    throw new Error(error);
  }
  await repo.updateProcessingRun(payload.processingRunId, {
    status: result.status,
    result,
    containerInstance: payload.audiobookId,
  });
  await repo.audit("processing_run", payload.processingRunId, "container.completed", "workflow", {
    completedAt: nowIso(),
    resultStatus: result.status,
  });
  if (result.status !== "succeeded" && result.errors?.length) {
    await repo.audit("processing_run", payload.processingRunId, "container.errors", "workflow", {
      message: result.errors.join("; "),
      errors: result.errors,
    });
  }
  await recordProcessingResult(repo, payload.audiobookId, result);

  if (result.status === "succeeded") {
    await repo.updateAudiobook(payload.audiobookId, {
      dossierStatus: "sample_pending",
      processingStatus: "succeeded",
    });
    await repo.updateProcessingRun(payload.processingRunId, { status: "succeeded", result });
  } else {
    await repo.updateAudiobook(payload.audiobookId, { dossierStatus: "failed" });
  }

  await repo.audit("processing_run", payload.processingRunId, "workflow.completed", "workflow", {
    completedAt: nowIso(),
    finalStatus: result.status,
  });
}

export class ProcessingWorkflow extends WorkflowEntrypoint<Env, { payload: ProcessingJobPayload }> {
  async run(event: WorkflowEvent<{ payload: ProcessingJobPayload }>, step: WorkflowStep) {
    const payload = event.payload.payload;
    await step.do("run processing pipeline", async () => {
      await runProcessingPipeline(this.env, payload);
    });
  }
}

export class DossierWorkflow extends WorkflowEntrypoint<Env, { payload: DossierJobPayload }> {
  async run(event: WorkflowEvent<{ payload: DossierJobPayload }>, step: WorkflowStep) {
    const { audiobookId, apiBaseUrl } = event.payload.payload;
    try {
      await step.do("finalize dossier", { timeout: "30 minutes", retries: { limit: 0, delay: "1 second" } }, async () => {
        const repo = new Repository(this.env.DB);
        await finalizeAudiobookDossier(this.env, repo, audiobookId, apiBaseUrl);
      });
    } catch (error) {
      const repo = new Repository(this.env.DB);
      const errorMessage = error instanceof Error ? error.message : String(error);
      await repo.updateAudiobook(audiobookId, { dossierStatus: "failed" });
      await repo.audit("audiobook_record", audiobookId, "dossier.failed", "dossier_workflow", {
        message: errorMessage,
        failedAt: nowIso(),
      });
      // Do NOT re-throw — letting the workflow complete cleanly prevents CF from retrying the instance
    }
  }
}

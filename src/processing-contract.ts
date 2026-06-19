import type { ProcessingJobPayload } from "./types";
import { keySegments, signInternalArtifactUrl, signMultipartUrl } from "./utils";

export async function buildProcessingPayload(input: {
  audiobookId: string;
  processingRunId: string;
  publisherId: number;
  storageBasePath: string;
  apiBaseUrl: string;
  internalSecret: string;
  accessClientId?: string;
  accessClientSecret?: string;
  approvedTracks: ProcessingJobPayload["approvedTracks"];
}) {
  const expiresAt = Date.now() + 60 * 60 * 1000;
  const targetArtifactPrefix = keySegments(input.storageBasePath, "artifacts");
  const targetDossierPrefix = keySegments(input.storageBasePath, "dossier");
  const inputTracks = await Promise.all(
    input.approvedTracks.map(async (track) => {
      const safeName = `${String(track.originalOrderIndex).padStart(2, "0")}-${track.originalFilename}`;
      const finalObjectKey = keySegments(targetArtifactPrefix, "processed", safeName.replace(/\.[^.]+$/i, ".mp3"));
      const sourceType: ProcessingJobPayload["inputTracks"][number]["sourceType"] =
        track.sourceType === "archive_entry" || /\.zip$/i.test(track.originalObjectKey) ? "archive_entry" : "direct_audio";
      return {
        sourceType,
        originalFilename: track.originalFilename,
        originalObjectKey: track.originalObjectKey,
        archiveEntryName: sourceType === "archive_entry" ? track.originalFilename : undefined,
        downloadUrl: await signInternalArtifactUrl({
          baseUrl: input.apiBaseUrl,
          path: "/api/internal/artifacts",
          key: track.originalObjectKey,
          method: "GET",
          secret: input.internalSecret,
          expiresAt,
        }),
        upload: {
          objectKey: finalObjectKey,
          uploadUrl: await signInternalArtifactUrl({
            baseUrl: input.apiBaseUrl,
            path: "/api/internal/artifacts",
            key: finalObjectKey,
            method: "PUT",
            secret: input.internalSecret,
            expiresAt,
          }),
          multipartStartUrl: await signMultipartUrl({
            baseUrl: input.apiBaseUrl,
            path: "/api/internal/multipart-start",
            key: finalObjectKey,
            method: "POST",
            secret: input.internalSecret,
            expiresAt,
          }),
        },
      };
    }),
  );

  return {
    processingRunId: input.processingRunId,
    audiobookId: input.audiobookId,
    publisherId: input.publisherId,
    inputTracks,
    workingPrefix: keySegments("ingestions", input.audiobookId, "working"),
    targetArtifactPrefix,
    targetDossierPrefix,
    approvedTracks: input.approvedTracks,
    apiBaseUrl: input.apiBaseUrl,
    progressCallbackUrl: `${input.apiBaseUrl}/api/internal/processing-progress`,
    trackProgressCallbackUrl: `${input.apiBaseUrl}/api/internal/track-progress`,
    internalSecret: input.internalSecret,
    accessClientId: input.accessClientId,
    accessClientSecret: input.accessClientSecret,
    maxBookBytes: 1024 * 1024 * 1024,
    maxTrackBytes: 200 * 1024 * 1024,
  } satisfies ProcessingJobPayload;
}

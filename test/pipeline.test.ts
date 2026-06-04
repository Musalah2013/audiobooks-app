import { describe, expect, it } from "vitest";
import { buildNormalizedGroups } from "../src/pipeline";
import { buildProcessingPayload } from "../src/processing-contract";
import { inferIntakeMode } from "../src/utils";

describe("ingestion grouping", () => {
  it("detects a single zip as single_book_zip", () => {
    const manifest = [
      {
        key: "ingestions/b1/source/book.zip",
        name: "book.zip",
        mimeType: "application/zip",
        sizeBytes: 123,
        parentPath: "",
      },
    ];

    expect(inferIntakeMode(manifest)).toBe("single_book_zip");
    expect(buildNormalizedGroups(manifest)).toHaveLength(1);
  });

  it("groups tracks by folder", () => {
    const manifest = [
      {
        key: "ingestions/b1/source/book-a/01.mp3",
        name: "01.mp3",
        mimeType: "audio/mpeg",
        sizeBytes: 123,
        parentPath: "book-a",
      },
      {
        key: "ingestions/b1/source/book-a/02.mp3",
        name: "02.mp3",
        mimeType: "audio/mpeg",
        sizeBytes: 456,
        parentPath: "book-a",
      },
    ];

    const groups = buildNormalizedGroups(manifest);
    expect(groups).toHaveLength(1);
    expect(groups[0].items).toHaveLength(2);
  });
});

describe("workflow payload", () => {
  it("builds publisher-scoped prefixes", async () => {
    const payload = await buildProcessingPayload({
      audiobookId: "book-123",
      processingRunId: "run-123",
      publisherId: 42,
      storageBasePath: "42_publisher-name/9781234567890_book-title",
      apiBaseUrl: "https://example.com",
      internalSecret: "secret",
      approvedTracks: [
        {
          originalObjectKey: "ingestions/b1/working/01.mp3",
          originalFilename: "01.mp3",
          originalOrderIndex: 1,
          titleProvenance: "filename",
          proposedTitle: "Intro",
        },
      ],
    });

    expect(payload.targetArtifactPrefix).toBe("42_publisher-name/9781234567890_book-title/artifacts");
    expect(payload.targetDossierPrefix).toBe("42_publisher-name/9781234567890_book-title/dossier");
    expect(payload.inputTracks[0].upload.objectKey).toBe("42_publisher-name/9781234567890_book-title/artifacts/processed/01-01.mp3");
  });
});

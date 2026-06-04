import express from "express";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { XMLParser } from "fast-xml-parser";
import JSZip from "jszip";
import * as XLSX from "xlsx";

const execFileAsync = promisify(execFile);
const app = express();
app.use(express.json({ limit: "10mb" }));
const jobs = new Map();

const BITRATE_STEPS = [24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192];

function sanitizeFilename(input) {
  return input.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/\s+/g, " ").trim();
}

function isAudioFilename(input) {
  return /\.(mp3|m4a|wav)$/i.test(input);
}

function chooseBitrate(capKbps) {
  if (!Number.isFinite(capKbps) || capKbps <= 0) return BITRATE_STEPS[0];
  let chosen = BITRATE_STEPS[0];
  for (const step of BITRATE_STEPS) {
    if (step <= capKbps) chosen = step;
  }
  return chosen;
}

async function run(command, args) {
  const { stdout, stderr } = await execFileAsync(command, args, { maxBuffer: 10 * 1024 * 1024 });
  return { stdout, stderr };
}

function parseProbeJson(stdout, filePath) {
  const parsed = JSON.parse(stdout);
  const audioStream = Array.isArray(parsed.streams) ? parsed.streams[0] ?? {} : {};
  return {
    _filePath: filePath,
    durationSeconds: Number(parsed.format?.duration ?? 0),
    bitrateKbps: Math.round(Number(audioStream.bit_rate ?? parsed.format?.bit_rate ?? 0) / 1000) || undefined,
    sampleRateHz: Number(audioStream.sample_rate ?? 0) || undefined,
    channels: Number(audioStream.channels ?? 0) || undefined,
  };
}

async function probeAudio(filePath) {
  const SHOW_ENTRIES = "format=duration,bit_rate:stream=sample_rate,channels,bit_rate";
  const PROBE_ARGS = ["-show_entries", SHOW_ENTRIES, "-of", "json", filePath];
  const fileStat = await stat(filePath);

  // Strategy 1: strict/fast probe — works for well-formed files
  try {
    const { stdout } = await run("ffprobe", ["-v", "error", ...PROBE_ARGS]);
    const info = parseProbeJson(stdout, filePath);
    return { sizeBytes: fileStat.size, durationSeconds: info.durationSeconds, bitrateKbps: info.bitrateKbps, sampleRateHz: info.sampleRateHz, channels: info.channels };
  } catch { /* fall through */ }

  // Strategy 2: lenient ffprobe — larger read window for files with big ID3 tags or
  // junk bytes before the first MPEG sync word
  try {
    const { stdout } = await run("ffprobe", [
      "-v", "warning", "-analyzeduration", "100M", "-probesize", "100M",
      ...PROBE_ARGS,
    ]);
    const info = parseProbeJson(stdout, filePath);
    return { sizeBytes: fileStat.size, durationSeconds: info.durationSeconds, bitrateKbps: info.bitrateKbps, sampleRateHz: info.sampleRateHz, channels: info.channels };
  } catch { /* fall through */ }

  // Strategy 3: ffmpeg -i based probe — parses the stream info header from stderr;
  // ffmpeg always exits non-zero when given no output but still prints stream info
  let ffmpegStderr = "";
  try {
    await execFileAsync("ffmpeg", ["-i", filePath, "-f", "null", "-"], { maxBuffer: 10 * 1024 * 1024 });
  } catch (err) {
    ffmpegStderr = (err && typeof err === "object" && "stderr" in err ? String(err.stderr) : "") || "";
  }
  if (!ffmpegStderr) throw new Error(`probeAudio: all probe strategies exhausted for ${filePath}`);

  const durationMatch = ffmpegStderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const durationSeconds = durationMatch
    ? Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3])
    : 0;
  const bitrateMatch = ffmpegStderr.match(/bitrate:\s*(\d+)\s*kb\/s/);
  const bitrateKbps = bitrateMatch ? Number(bitrateMatch[1]) : undefined;
  const sampleRateMatch = ffmpegStderr.match(/(\d+)\s*Hz/);
  const sampleRateHz = sampleRateMatch ? Number(sampleRateMatch[1]) : undefined;
  let channels;
  if (/\bstereo\b/i.test(ffmpegStderr)) channels = 2;
  else if (/\bmono\b/i.test(ffmpegStderr)) channels = 1;
  else { const m = ffmpegStderr.match(/(\d+)\s*channels/i); if (m) channels = Number(m[1]); }

  return { sizeBytes: fileStat.size, durationSeconds, bitrateKbps, sampleRateHz, channels };
}

function fetchCauseMessage(err) {
  if (!err) return "";
  const cause = err.cause;
  if (!cause) return "";
  return cause.code ? `${cause.code}: ${cause.message ?? ""}` : String(cause.message ?? cause);
}

function accessHeaders(payload) {
  if (payload?.accessClientId && payload?.accessClientSecret) {
    return { "CF-Access-Client-Id": payload.accessClientId, "CF-Access-Client-Secret": payload.accessClientSecret };
  }
  return {};
}

async function downloadToFile(url, destination, extraHeaders = {}) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, { headers: extraHeaders, redirect: "error" });
      if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      await writeFile(destination, bytes);
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const cause = fetchCauseMessage(err);
      const detail = cause ? `${msg} (${cause})` : msg;
      if (attempt === 3) throw new Error(`Download failed after ${attempt} attempts — ${detail} — ${url}`);
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

async function uploadFile(url, filePath, contentType, extraHeaders = {}) {
  // Force HTTPS: an HTTP upload URL causes Cloudflare to 302-redirect to HTTPS, which
  // fetch() handles by converting PUT→GET (spec-compliant), landing on the wrong handler.
  // Blob body avoids the ArrayBuffer-detachment issue with Buffer/Uint8Array in undici.
  const httpsUrl = url.replace(/^http:\/\//, "https://");
  const fileBytes = await readFile(filePath);
  const blob = new Blob([fileBytes], { type: contentType });
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(httpsUrl, { method: "PUT", body: blob, redirect: "error", headers: extraHeaders });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`Upload failed: HTTP ${response.status} — ${body.slice(0, 200)}`);
      }
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const cause = fetchCauseMessage(err);
      const detail = cause ? `${msg} (${cause})` : msg;
      if (attempt === 3) throw new Error(`Upload failed after ${attempt} attempts — ${detail}`);
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

async function postTrackProgress(payload, trackData) {
  if (!payload?.trackProgressCallbackUrl || !payload?.internalSecret) return;
  try {
    await fetch(payload.trackProgressCallbackUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Secret": payload.internalSecret, ...accessHeaders(payload) },
      body: JSON.stringify({ audiobookId: payload.audiobookId, ...trackData }),
    });
  } catch (_error) {
    // Best-effort only — don't fail the job if the callback fails
  }
}

async function postProgress(payload, step, message, status = null) {
  if (!payload?.progressCallbackUrl || !payload?.internalSecret) return;
  try {
    await fetch(payload.progressCallbackUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": payload.internalSecret,
        ...accessHeaders(payload),
      },
      body: JSON.stringify({
        processingRunId: payload.processingRunId,
        step,
        message,
        status,
      }),
    });
  } catch (_error) {
    // Progress callbacks are best-effort only.
  }
}

async function transcodeTrack(inputPath, outputPath, bitrateKbps) {
  await run("ffmpeg", [
    "-y",
    "-i",
    inputPath,
    "-vn",
    "-map",
    "a:0",
    "-codec:a",
    "libmp3lame",
    "-b:a",
    `${bitrateKbps}k`,
    "-ar",
    "44100",
    outputPath,
  ]);
}

// Cache parsed ZIP objects by path — each job uses a unique tmpdir so paths never collide across jobs.
// All concurrent callers for the same path share the same Promise, so the ZIP is read and parsed exactly once.
const _zipCache = new Map();
function loadZip(archivePath) {
  if (!_zipCache.has(archivePath)) {
    _zipCache.set(archivePath, readFile(archivePath).then((data) => JSZip.loadAsync(data)));
  }
  return _zipCache.get(archivePath);
}
function evictZip(archivePath) {
  _zipCache.delete(archivePath);
}

async function listArchiveEntries(archivePath) {
  const zip = await loadZip(archivePath);
  return Object.keys(zip.files)
    .filter((name) => !zip.files[name].dir)
    .filter(isAudioFilename)
    .map((entryName) => ({
      entryName,
      displayName: entryName.split("/").pop() ?? entryName,
    }));
}

async function extractArchiveEntry(archivePath, entryName, workDir, orderIndex) {
  const zip = await loadZip(archivePath);
  const file = zip.file(entryName);
  if (!file) throw new Error(`Entry not found in archive: ${entryName}`);
  const content = await file.async("nodebuffer");
  const extractedPath = path.join(workDir, `archive-${orderIndex}`, entryName);
  await mkdir(path.dirname(extractedPath), { recursive: true });
  await writeFile(extractedPath, content);
  return extractedPath;
}

async function generateSampleClip(inputPath, outputPath, startSeconds = 0, endSeconds = 30) {
  const duration = Math.max(1, endSeconds - startSeconds);
  await run("ffmpeg", [
    "-y",
    "-ss",
    String(Math.max(0, startSeconds)),
    "-i",
    inputPath,
    "-t",
    String(duration),
    "-codec:a",
    "libmp3lame",
    "-b:a",
    "64k",
    "-ar",
    "44100",
    outputPath,
  ]);
}

function maxBitrateForSize(maxBytes, durationSeconds) {
  if (!durationSeconds || durationSeconds <= 0) return BITRATE_STEPS[0];
  return (maxBytes * 8) / durationSeconds / 1000;
}

function toNumber(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function toArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function columnIndexFromRef(ref) {
  const letters = String(ref || "").match(/[A-Z]+/i)?.[0] || "";
  let index = 0;
  for (const char of letters.toUpperCase()) {
    index = index * 26 + (char.charCodeAt(0) - 64);
  }
  return Math.max(0, index - 1);
}

function extractCellValue(cell, sharedStrings) {
  if (!cell) return "";
  if (cell.t === "inlineStr") {
    return cell.is?.t ?? cell.is?.r?.t ?? "";
  }
  const value = cell.v ?? "";
  if (cell.t === "s") {
    const idx = Number(value);
    return Number.isFinite(idx) ? (sharedStrings[idx] ?? "") : "";
  }
  return value;
}

async function parseWorkbookWithoutStyles(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "", preserveOrder: false });
  const worksheetName = Object.keys(zip.files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))[0];
  if (!worksheetName) {
    return [];
  }

  const sharedStrings = [];
  const sharedStringsFile = zip.file("xl/sharedStrings.xml");
  if (sharedStringsFile) {
    const sharedXml = parser.parse(await sharedStringsFile.async("string"));
    for (const si of toArray(sharedXml?.sst?.si)) {
      if (typeof si?.t === "string") {
        sharedStrings.push(si.t);
      } else {
        const textParts = toArray(si?.r).map((entry) => entry?.t ?? "").join("");
        sharedStrings.push(textParts);
      }
    }
  }

  const worksheetXml = parser.parse(await zip.file(worksheetName).async("string"));
  const rows = toArray(worksheetXml?.worksheet?.sheetData?.row).map((row) => {
    const output = [];
    for (const cell of toArray(row?.c)) {
      const index = columnIndexFromRef(cell?.r);
      output[index] = String(extractCellValue(cell, sharedStrings) ?? "");
    }
    return output;
  });
  return rows.map((values, index) => ({
    rowNumber: index + 1,
    values: values.map((value) => String(value ?? "")),
  }));
}

function parseWorkbookWithSheetJs(buffer) {
  const wb = XLSX.read(buffer, { type: "buffer", cellStyles: false, cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  return rows.map((values, index) => ({
    rowNumber: index + 1,
    values: Array.isArray(values) ? values.map((v) => String(v ?? "")) : [],
  }));
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, runtime: "cloudflare-container-real-processor" });
});

app.post("/inspect-archive", async (req, res) => {
  const payload = req.body;
  const workDir = await mkdtemp(path.join(tmpdir(), "audiobooks-archive-inspect-"));

  try {
    const archives = Array.isArray(payload.archives) ? payload.archives : [];
    const inspected = [];
    for (const archive of archives) {
      const archivePath = path.join(workDir, sanitizeFilename(archive.filename || "archive.zip"));
      await downloadToFile(archive.downloadUrl, archivePath, accessHeaders(payload));
      inspected.push({
        objectKey: archive.objectKey,
        filename: archive.filename,
        entries: await listArchiveEntries(archivePath),
      });
    }
    res.json({ archives: inspected });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

app.post("/parse-workbook", express.raw({ type: "application/octet-stream", limit: "100mb" }), async (req, res) => {
  const fileName = req.headers["x-file-name"] || "metadata.xlsx";
  const workDir = await mkdtemp(path.join(tmpdir(), "audiobooks-workbook-"));
  const workbookPath = path.join(workDir, sanitizeFilename(String(fileName)));

  try {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw new Error("Missing or empty workbook body");
    }
    await writeFile(workbookPath, req.body);
    const bytes = await readFile(workbookPath);
    let rawRows;
    try {
      rawRows = await parseWorkbookWithoutStyles(bytes);
    } catch (_zipErr) {
      // Fall back to SheetJS for .xls (BIFF) and other non-standard formats
      rawRows = parseWorkbookWithSheetJs(bytes);
    }
    res.json({ rawRows });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

// Runs fn over items with at most `limit` concurrent executions, preserving result order.
async function concurrentMap(items, limit, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function executeProcessingJob(payload) {
  const workDir = await mkdtemp(path.join(tmpdir(), "audiobooks-processor-"));

  try {
    await postProgress(payload, "starting", "Container processing started.", "running");
    const approvedTracks = Array.isArray(payload.approvedTracks) ? payload.approvedTracks : [];
    const inputTracks = Array.isArray(payload.inputTracks) ? payload.inputTracks : [];
    const trackDefinitions = approvedTracks.map((track) => {
      const transport = inputTracks.find((entry) => entry.originalFilename === track.originalFilename);
      if (!transport) {
        throw new Error(`Missing transport entry for ${track.originalFilename}`);
      }
      return { track, transport };
    });

    // Phase 1: download + probe — 3 tracks at a time.
    // Archive downloads are deduplicated: only the first requester downloads;
    // subsequent tracks from the same archive await the same Promise.
    const archivePromises = new Map(); // objectKey -> Promise<localPath>
    let archiveCounter = 0;

    await postProgress(payload, "preparing_inputs", `Preparing ${trackDefinitions.length} approved tracks.`, "running");

    const originals = await concurrentMap(trackDefinitions, 3, async ({ track, transport }) => {
      const sourcePath = path.join(workDir, `source-${track.originalOrderIndex}.mp3`);
      if (transport.sourceType === "archive_entry") {
        const archiveKey = transport.originalObjectKey;
        if (!archivePromises.has(archiveKey)) {
          const archivePath = path.join(workDir, `archive-${++archiveCounter}.zip`);
          archivePromises.set(archiveKey, downloadToFile(transport.downloadUrl, archivePath, accessHeaders(payload)).then(() => archivePath));
        }
        const archivePath = await archivePromises.get(archiveKey);
        const extractedPath = await extractArchiveEntry(
          archivePath,
          transport.archiveEntryName || transport.originalFilename,
          workDir,
          track.originalOrderIndex,
        );
        const bytes = await readFile(extractedPath);
        await writeFile(sourcePath, bytes);
      } else {
        await downloadToFile(transport.downloadUrl, sourcePath, accessHeaders(payload));
      }
      const originalProbe = await probeAudio(sourcePath);
      return { track, transport, sourcePath, originalProbe };
    });

    // Size check — must happen after all probes are complete
    const totalOriginalSizeBytes = originals.reduce((sum, item) => sum + item.originalProbe.sizeBytes, 0);
    const allTracksWithinLimit = originals.every((item) => item.originalProbe.sizeBytes < payload.maxTrackBytes);
    const bookWithinLimit = totalOriginalSizeBytes < payload.maxBookBytes;
    const skipResize = bookWithinLimit && allTracksWithinLimit;
    await postProgress(
      payload,
      "size_check",
      skipResize
        ? `Size check passed — ${Math.round(totalOriginalSizeBytes / 1024 / 1024)} MB total, all tracks under 100 MB. No resizing needed.`
        : `Size check: ${Math.round(totalOriginalSizeBytes / 1024 / 1024)} MB total${!allTracksWithinLimit ? ", one or more tracks ≥ 100 MB" : ""}. Resize will be applied.`,
      "running",
    );

    const totalDurationSeconds = originals.reduce((sum, item) => sum + item.originalProbe.durationSeconds, 0);
    const totalCapKbps = skipResize ? Number.POSITIVE_INFINITY : maxBitrateForSize(payload.maxBookBytes, totalDurationSeconds);

    // Phase 2: transcode + upload + callback — 3 tracks at a time.
    const processed = await concurrentMap(originals, 3, async (item) => {
      await postProgress(
        payload,
        "transcoding_track",
        `Processing track ${item.track.originalOrderIndex}/${originals.length}: ${item.track.originalFilename}.`,
        "running",
      );
      const finalPath = path.join(workDir, `final-${item.track.originalOrderIndex}.mp3`);
      let finalProbe;

      if (skipResize) {
        // Files are within size limits — avoid quality reduction.
        // MP3 sources are copied as-is; other formats are converted at original bitrate.
        const isMp3 = /\.mp3$/i.test(item.track.originalFilename);
        if (isMp3) {
          await writeFile(finalPath, await readFile(item.sourcePath));
        } else {
          await transcodeTrack(item.sourcePath, finalPath, chooseBitrate(item.originalProbe.bitrateKbps ?? 128));
        }
        finalProbe = await probeAudio(finalPath);
      } else {
        const perTrackCapKbps = maxBitrateForSize(payload.maxTrackBytes, item.originalProbe.durationSeconds);
        let selectedBitrate = chooseBitrate(
          Math.min(item.originalProbe.bitrateKbps ?? 128, perTrackCapKbps, totalCapKbps),
        );
        for (;;) {
          await transcodeTrack(item.sourcePath, finalPath, selectedBitrate);
          finalProbe = await probeAudio(finalPath);
          if (finalProbe.sizeBytes <= payload.maxTrackBytes) break;
          const lowerBitrates = BITRATE_STEPS.filter((step) => step < selectedBitrate);
          if (!lowerBitrates.length) break;
          selectedBitrate = lowerBitrates[lowerBitrates.length - 1];
        }
      }

      const finalTitle = item.track.proposedTitle;
      const finalFilename = `${String(item.track.originalOrderIndex).padStart(3, "0")}.mp3`;
      await postProgress(payload, "uploading_track", `Uploading processed track ${finalFilename}.`, "running");
      await uploadFile(item.transport.upload.uploadUrl, finalPath, "audio/mpeg", accessHeaders(payload));

      const notes = skipResize
        ? "Within size limits — no resize applied."
        : (finalProbe.bitrateKbps && item.originalProbe.bitrateKbps && finalProbe.bitrateKbps < item.originalProbe.bitrateKbps
          ? `Transcoded to ${finalProbe.bitrateKbps} kbps.`
          : "Validated without additional reduction.");

      await postTrackProgress(payload, {
        originalFilename: item.track.originalFilename,
        originalSizeBytes: item.originalProbe.sizeBytes,
        originalDurationSeconds: item.originalProbe.durationSeconds,
        originalBitrateKbps: item.originalProbe.bitrateKbps,
        originalSampleRateHz: item.originalProbe.sampleRateHz,
        originalChannels: item.originalProbe.channels,
        finalObjectKey: item.transport.upload.objectKey,
        finalFilename,
        finalTitle,
        finalSizeBytes: finalProbe.sizeBytes,
        finalDurationSeconds: finalProbe.durationSeconds,
        finalBitrateKbps: finalProbe.bitrateKbps,
        finalSampleRateHz: finalProbe.sampleRateHz,
        finalChannels: finalProbe.channels,
        notes,
      });

      return {
        originalFilename: item.track.originalFilename,
        originalObjectKey: item.transport.originalObjectKey,
        originalSizeBytes: item.originalProbe.sizeBytes,
        originalDurationSeconds: item.originalProbe.durationSeconds,
        originalBitrateKbps: item.originalProbe.bitrateKbps,
        originalSampleRateHz: item.originalProbe.sampleRateHz,
        originalChannels: item.originalProbe.channels,
        finalFilename,
        finalObjectKey: item.transport.upload.objectKey,
        finalTitle,
        finalSizeBytes: finalProbe.sizeBytes,
        finalDurationSeconds: finalProbe.durationSeconds,
        finalBitrateKbps: finalProbe.bitrateKbps,
        finalSampleRateHz: finalProbe.sampleRateHz,
        finalChannels: finalProbe.channels,
        notes,
      };
    });

    const totalFinalSizeBytes = processed.reduce((sum, track) => sum + (track.finalSizeBytes ?? 0), 0);
    const hasOversizedTrack = processed.some((track) => (track.finalSizeBytes ?? 0) > payload.maxTrackBytes);
    const hasOversizedBook = totalFinalSizeBytes > payload.maxBookBytes;

    await postProgress(
      payload,
      "container_complete",
      hasOversizedTrack || hasOversizedBook ? "Container processing completed with blocking validation issues." : "Container processing completed successfully.",
      "running",
    );
    return {
      status: hasOversizedTrack || hasOversizedBook ? "failed_blocking" : "succeeded",
      summary: {
        totalOriginalSizeBytes,
        totalFinalSizeBytes,
      },
      tracks: processed,
      errors:
        hasOversizedTrack || hasOversizedBook
          ? [
              hasOversizedTrack ? "One or more final tracks still exceed 100 MB." : null,
              hasOversizedBook ? "Final audiobook still exceeds 400 MB." : null,
            ].filter(Boolean)
          : [],
    };
  } catch (error) {
    await postProgress(payload, "failed", error instanceof Error ? error.message : String(error), "failed_retryable");
    return {
      status: "failed_retryable",
      summary: {
        totalOriginalSizeBytes: 0,
        totalFinalSizeBytes: 0,
      },
      tracks: [],
      errors: [error instanceof Error ? error.message : String(error)],
    };
  } finally {
    for (const key of _zipCache.keys()) {
      if (key.startsWith(workDir)) evictZip(key);
    }
    await rm(workDir, { recursive: true, force: true });
  }
}

app.post("/process", async (req, res) => {
  const payload = req.body;
  const jobId = String(payload?.processingRunId || crypto.randomUUID());
  const existing = jobs.get(jobId);
  if (!existing) {
    jobs.set(jobId, {
      jobId,
      status: "queued",
      updatedAt: new Date().toISOString(),
      result: null,
      error: null,
    });
    (async () => {
      jobs.set(jobId, {
        jobId,
        status: "running",
        updatedAt: new Date().toISOString(),
        result: null,
        error: null,
      });
      try {
        const result = await executeProcessingJob(payload);
        jobs.set(jobId, {
          jobId,
          status: "completed",
          updatedAt: new Date().toISOString(),
          result,
          error: null,
        });
      } catch (error) {
        jobs.set(jobId, {
          jobId,
          status: "failed",
          updatedAt: new Date().toISOString(),
          result: null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  }
  res.status(202).json({ jobId, status: jobs.get(jobId)?.status ?? "queued" });
});

async function executeZipJob(payload, onProgress) {
  const workDir = await mkdtemp(path.join(tmpdir(), "audiobooks-zip-"));
  try {
    const zip = new JSZip();
    const files = Array.isArray(payload.files) ? payload.files : [];
    const total = files.length;
    onProgress({ phase: "downloading", filesDownloaded: 0, totalFiles: total });
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const localPath = path.join(workDir, `dl-${crypto.randomUUID()}`);
      await downloadToFile(file.downloadUrl, localPath, accessHeaders(payload));
      const folder = file.folder ? zip.folder(file.folder) : zip;
      folder.file(file.name, await readFile(localPath));
      onProgress({ phase: "downloading", filesDownloaded: i + 1, totalFiles: total });
    }
    onProgress({ phase: "compressing", filesDownloaded: total, totalFiles: total });
    const content = await zip.generateAsync({ type: "uint8array" });
    const zipPath = path.join(workDir, "output.zip");
    await writeFile(zipPath, content);
    onProgress({ phase: "uploading", filesDownloaded: total, totalFiles: total });
    const PART_SIZE = 10 * 1024 * 1024;
    const zipSize = content.byteLength;
    const numParts = Math.ceil(zipSize / PART_SIZE);
    const startResp = await fetch(`${payload.multipartStartUrl}&numParts=${numParts}`, { method: "POST", headers: accessHeaders(payload) });
    if (!startResp.ok) throw new Error(`Multipart start failed: ${startResp.status} ${await startResp.text().catch(() => "")}`);
    const { partUrls, completeUrl } = await startResp.json();
    const parts = [];
    const { open } = await import("fs/promises");
    const fh = await open(zipPath, "r");
    try {
      for (let i = 0; i < numParts; i++) {
        const offset = i * PART_SIZE;
        const length = Math.min(PART_SIZE, zipSize - offset);
        const chunk = Buffer.allocUnsafe(length);
        await fh.read(chunk, 0, length, offset);
        const partResp = await fetch(partUrls[i], {
          method: "PUT",
          body: chunk,
          headers: { "Content-Length": String(length), ...accessHeaders(payload) },
          duplex: "half",
        });
        if (!partResp.ok) throw new Error(`Part ${i + 1} upload failed: ${partResp.status} ${await partResp.text().catch(() => "")}`);
        const { etag, partNumber } = await partResp.json();
        parts.push({ partNumber, etag });
      }
    } finally {
      await fh.close();
    }
    const completeResp = await fetch(completeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...accessHeaders(payload) },
      body: JSON.stringify({ parts }),
    });
    if (!completeResp.ok) throw new Error(`Multipart complete failed: ${completeResp.status} ${await completeResp.text().catch(() => "")}`);
    return { sizeBytes: zipSize };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

app.post("/package-zip", async (req, res) => {
  const payload = req.body;
  const jobId = String(payload?.jobId || crypto.randomUUID());
  const existing = jobs.get(jobId);
  if (!existing || existing.status === "failed") {
    jobs.set(jobId, { jobId, status: "queued", updatedAt: new Date().toISOString(), result: null, error: null, progress: null });
    (async () => {
      const setProgress = (progress) => {
        const current = jobs.get(jobId);
        if (current) jobs.set(jobId, { ...current, progress, updatedAt: new Date().toISOString() });
      };
      jobs.set(jobId, { jobId, status: "running", updatedAt: new Date().toISOString(), result: null, error: null, progress: null });
      try {
        const result = await executeZipJob(payload, setProgress);
        jobs.set(jobId, { jobId, status: "completed", updatedAt: new Date().toISOString(), result, error: null, progress: null });
      } catch (error) {
        jobs.set(jobId, { jobId, status: "failed", updatedAt: new Date().toISOString(), result: null, error: error instanceof Error ? error.message : String(error), progress: null });
      }
    })();
  }
  res.status(202).json({ jobId, status: jobs.get(jobId)?.status ?? "queued" });
});

app.post("/generate-sample", async (req, res) => {
  const payload = req.body;
  const workDir = await mkdtemp(path.join(tmpdir(), "audiobooks-sample-"));

  try {
    if (!payload?.downloadUrl || !payload?.sampleUpload?.uploadUrl) {
      throw new Error("Missing sample generation transport.");
    }
    const sourcePath = path.join(workDir, sanitizeFilename(payload.sourceFilename || "source.mp3"));
    const outputPath = path.join(workDir, "sample.mp3");
    await downloadToFile(payload.downloadUrl, sourcePath, accessHeaders(payload));
    await generateSampleClip(
      sourcePath,
      outputPath,
      Number(payload.startSeconds ?? 0),
      Number(payload.endSeconds ?? 30),
    );
    await uploadFile(payload.sampleUpload.uploadUrl, outputPath, "audio/mpeg", accessHeaders(payload));
    const probe = await probeAudio(outputPath);
    res.json({
      ok: true,
      sampleObjectKey: payload.sampleUpload.objectKey,
      durationSeconds: probe.durationSeconds,
      sizeBytes: probe.sizeBytes,
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

app.get("/jobs/:id", async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }
  res.json(job);
});

const port = Number(process.env.PORT || 8080);
app.listen(port, () => {
  console.log(`Audio processor listening on ${port}`);
});

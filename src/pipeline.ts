import { getContainer } from "@cloudflare/containers";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { AudioProcessorContainer } from "./container";
import { Repository, type AudiobookRecord, type CandidateRecord, type IngestionBatchRecord } from "./db";
import {
  attachCoverToClickUpTask,
  createClickUpTask,
  createR2Signer,
  getServiceAccountToken,
  listDriveFiles,
  lookupSamawyCandidates,
  updateClickUpTask,
} from "./integrations";
import { buildClickUpCustomFields, buildClickUpDescription } from "./clickup-fields";
import { mergeClickUpConfig } from "./clickup-config";
import type {
  ArtifactDescriptor,
  CandidateDecision,
  Env,
  MetadataRow,
  MetadataNormalizationReport,
  NormalizedGroup,
  ProcessingJobPayload,
  ProcessingJobResult,
  RawWorkbookRow,
  SampleGenerationPayload,
  SourceManifestItem,
  TrackDraft,
} from "./types";
import {
  buildAppBookUrl,
  buildCatalogStorageBasePath,
  inferIntakeMode,
  jsonParse,
  keySegments,
  naturalSort,
  nowIso,
  signInternalArtifactUrl,
  signMultipartUrl,
  similarity,
  slugify,
  toNumber,
} from "./utils";

function maybeCover(item: SourceManifestItem): boolean {
  // Any image file in a book source folder is treated as a cover candidate.
  // Arabic books commonly use names like "صورة.jpg", "الغلاف.jpg", or generic "1.jpg".
  return /\.(png|jpe?g|webp)$/i.test(item.name);
}

function maybeAudio(item: SourceManifestItem): boolean {
  return /\.(mp3|m4a|m4b|wav|flac|aac|ogg)$/i.test(item.name);
}

function maybeZip(item: SourceManifestItem): boolean {
  return /\.zip$/i.test(item.name);
}

function buildDriveSourceObjectKey(batchId: string, item: SourceManifestItem) {
  return keySegments("ingestions", batchId, "source", item.parentPath, `${item.key}__${item.name}`);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableCopyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("fetch_timeout") ||
    message.includes("read_idle_timeout") ||
    message.includes("network") ||
    message.includes("aborted") ||
    message.includes("Timed out") ||
    /Failed to download Drive file .*: (408|425|429|500|502|503|504)/.test(message)
  );
}

function chooseCopyConcurrency(items: SourceManifestItem[]) {
  const hasVeryLargeFile = items.some((item) => item.sizeBytes >= 512 * 1024 * 1024);
  const hasLargeFile = items.some((item) => item.sizeBytes >= 128 * 1024 * 1024);
  if (hasVeryLargeFile) return 3;
  if (hasLargeFile) return 5;
  return 8;
}

function chooseIdleTimeoutMs(item: SourceManifestItem) {
  if (item.sizeBytes >= 512 * 1024 * 1024) return 180_000;
  if (item.sizeBytes >= 128 * 1024 * 1024) return 90_000;
  return 45_000;
}

async function readWithIdleTimeout<T>(reader: ReadableStreamDefaultReader<T>, timeoutMs: number) {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`read_idle_timeout:${timeoutMs}`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function buildCanonicalMetadataSnapshot(input: {
  batch: IngestionBatchRecord;
  candidate: CandidateRecord;
  metadataRow?: MetadataRow;
  sourceGroup?: NormalizedGroup | null;
}) {
  const { batch, candidate, metadataRow, sourceGroup } = input;
  const ov = candidate.metadataOverride ?? {};
  return {
    title: ov.title ?? candidate.title,
    publisher: batch.sellerName,
    publisherId: batch.sellerId,
    subtitle: ov.subtitle ?? candidate.subtitle ?? metadataRow?.subtitle ?? null,
    genre: ov.genre ?? metadataRow?.genre ?? null,
    blurb: ov.blurb ?? metadataRow?.blurb ?? null,
    author: ov.author ?? candidate.author ?? metadataRow?.author ?? null,
    isbn: ov.isbn ?? candidate.isbn ?? metadataRow?.isbn ?? null,
    pubYear: ov.pubYear ?? metadataRow?.pubYear ?? null,
    sellingType: ov.sellingType ?? metadataRow?.sellingType ?? null,
    price: ov.price ?? metadataRow?.price ?? null,
    trackCount: ov.trackCount ?? metadataRow?.trackCount ?? (sourceGroup ? (sourceGroup.items.filter(maybeAudio).length || sourceGroup.items.filter(maybeZip).length || null) : null),
    totalOriginalBookSizeBytes: ov.totalOriginalBookSizeBytes ?? metadataRow?.totalOriginalBookSizeBytes ?? null,
    totalLengthSeconds: ov.totalLengthSeconds ?? metadataRow?.totalLengthSeconds ?? null,
    narrator: ov.narrator ?? candidate.narrator ?? metadataRow?.narrator ?? null,
    importancePoints: ov.importancePoints ?? metadataRow?.importancePoints ?? null,
    classificationDecision: candidate.classificationDecision,
    sourceGroupKey: sourceGroup?.groupKey ?? null,
    sourceGroupName: sourceGroup?.displayName ?? null,
    sourceDriveLink: batch.driveLink ?? null,
    metadataRowIndex: metadataRow?.rowIndex ?? candidate.metadataRowIndex ?? null,
    coverCandidates: sourceGroup?.coverCandidates.map((item) => item.key) ?? [],
    samawyCandidates: candidate.samawyCandidates,
    hasMetadataOverride: Object.keys(ov).length > 0,
  };
}

const METADATA_FIELDS = [
  "title",
  "publisher",
  "subtitle",
  "genre",
  "blurb",
  "author",
  "isbn",
  "pubYear",
  "sellingType",
  "price",
  "trackCount",
  "totalOriginalBookSizeBytes",
  "totalLengthSeconds",
  "narrator",
  "importancePoints",
] as const;

type MetadataFieldName = typeof METADATA_FIELDS[number];

type HeaderDetectionResult = {
  strategy: "ai" | "heuristic";
  headerRowNumber: number | null;
  columns: Record<MetadataFieldName, { index: number | null; header?: string | null; confidence?: number | null }>;
  warnings?: string[];
};

function columnLabelFromIndex(index: number) {
  let value = index + 1;
  let label = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}

function sanitizeText(value: unknown): string | undefined {
  if (value == null) return undefined;
  const text = String(value).replace(/\s+/g, " ").trim();
  return text ? text : undefined;
}

function sanitizeStringOrNull(value: unknown): string | null {
  return sanitizeText(value) ?? null;
}

function sanitizeNumberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value).trim();
  const compact = text.replace(/[,\s]+/g, "");
  if (compact) {
    const direct = Number(compact);
    if (Number.isFinite(direct)) return direct;
  }
  const matched = text.match(/-?\d+(?:\.\d+)?/);
  if (!matched) return null;
  const parsed = Number(matched[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function sanitizeSellingType(value: unknown): "subscription" | "a_la_carte" | null {
  const text = sanitizeText(value)?.toLowerCase();
  if (!text) return null;
  if (["subscription", "subs", "اشتراك"].includes(text)) return "subscription";
  if (["a_la_carte", "a la carte", "ala carte", "individual", "شراء منفصل"].includes(text)) return "a_la_carte";
  return null;
}

function isLikelyBlankMatrixRow(row: RawWorkbookRow) {
  return row.values.every((value) => !sanitizeText(value));
}

function sanitizePubYearValue(value: unknown): string | undefined {
  const text = sanitizeText(value);
  if (!text) return undefined;
  const yearMatch = text.match(/\b(19|20)\d{2}\b/);
  return yearMatch ? yearMatch[0] : text;
}

function sanitizeContributorAuthor(value: unknown): string | undefined {
  const text = sanitizeText(value);
  if (!text) return undefined;
  const authorMatch = text.match(/\[AUTHOR\s*\|\s*([^\]|]+)/i);
  return authorMatch?.[1]?.replace(/\s+/g, " ").trim() || text;
}

function sanitizePublisherValue(value: unknown): string | undefined {
  const text = sanitizeText(value);
  if (!text) return undefined;
  if (/^\d+$/.test(text)) return undefined;
  return text;
}

function normalizedHeaderToken(header: string) {
  return header.toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/g, "");
}

function enrichWorkbookExportColumns(rowValues: string[], columns: HeaderDetectionResult["columns"]) {
  const tokens = rowValues.map((value) => normalizedHeaderToken(String(value ?? "")));
  const findToken = (...candidates: string[]) => tokens.findIndex((value) => candidates.includes(value));

  if (columns.title.index == null) {
    const productTypeIndex = findToken("producttype");
    const subtitleIndex = findToken("subtitle");
    if (productTypeIndex >= 0 && subtitleIndex === productTypeIndex + 2) {
      const titleIndex = productTypeIndex + 1;
      columns.title = { index: titleIndex, header: rowValues[titleIndex] ?? null, confidence: 0.72 };
    }
  }

  const exportedFieldCandidates: Array<[MetadataFieldName, string[]]> = [
    ["author", ["contributors", "contributorsengl"]],
    ["blurb", ["productinfotext", "productinfotextengl"]],
    ["isbn", ["isbnprint", "isbnepub", "isbnpdf"]],
    ["pubYear", ["releasedate", "printreleasedate"]],
    ["price", ["standardprices", "libraryprices", "priceprint"]],
    ["trackCount", ["numberofchapters"]],
    ["genre", ["genretextbisac1", "genrecodebisac1", "genretextwgs1", "genrecodewgs1"]],
    ["publisher", ["publisherid"]],
  ];

  for (const [field, candidates] of exportedFieldCandidates) {
    if (columns[field].index != null) continue;
    const index = findToken(...candidates);
    if (index >= 0) {
      columns[field] = { index, header: rowValues[index] ?? null, confidence: 0.7 };
    }
  }
}

function heuristicHeaderAliasMap(header: string) {
  const normalized = header.toLowerCase().replace(/[\s_\-\/\\:]+/g, " ").trim();
  if (!normalized) return null;
  const aliasMap: Record<MetadataFieldName, string[]> = {
    title: ["title", "book title", "audiobook title", "product title", "اسم الكتاب", "العنوان", "عنوان الكتاب", "الأسم", "الاسم", "اسم", "اسم الكتاب الصوتي", "عنوان"],
    publisher: ["publisher", "publishing house", "publisherid", "دار النشر", "الناشر", "الناشر/دار النشر", "جهة النشر"],
    subtitle: ["subtitle", "sub title", "العنوان الفرعي", "عنوان فرعي"],
    genre: ["genre", "category", "genretextbisac1", "genrecodebisac1", "genretextwgs1", "التصنيف", "النوع", "الفئة", "تصنيف"],
    blurb: ["blurb", "description", "synopsis", "summary", "product description", "productinfotext", "product info text", "productdescription", "نبذة", "الوصف", "وصف الكتاب", "نبذة الكتاب", "نبذة عن الكتاب", "ملخص", "ملخص الكتاب", "عن الكتاب", "تعريف الكتاب", "موضوع الكتاب", "قصة الكتاب", "نبذة مختصرة", "الملخص"],
    author: ["author", "writer", "contributors", "contributorsengl", "المؤلف", "الكاتب", "اسم المؤلف", "اسم الكاتب"],
    isbn: ["isbn", "isbnprint", "isbnepub", "isbnpdf", "ردمك", "رقم isbn", "الرقم المعياري"],
    pubYear: ["publishing year", "publication year", "pub year", "year", "releasedate", "printreleasedate", "سنة النشر", "سنة الإصدار", "تاريخ الإصدار", "سنة"],
    sellingType: ["selling type", "sale type", "نوع البيع", "طريقة البيع"],
    price: ["price", "selling price", "standardprices", "libraryprices", "priceprint", "السعر", "سعر البيع"],
    trackCount: ["track count", "tracks count", "number of tracks", "numberofchapters", "عدد المقاطع", "عدد التراكات", "عدد الفصول"],
    totalOriginalBookSizeBytes: ["total original book size bytes", "original size", "size bytes", "حجم الكتاب"],
    totalLengthSeconds: ["total length seconds", "total length", "duration", "مدة الكتاب", "المدة الإجمالية"],
    narrator: ["narrator", "narrator name", "الراوي", "اسم الراوي", "الملقي", "المؤدي"],
    importancePoints: ["importance points", "book importance points", "نقاط الأهمية", "درجة الأهمية"],
  };
  for (const field of METADATA_FIELDS) {
    if (aliasMap[field].includes(normalized)) return field;
  }
  // Partial-match fallback for blurb: any header containing key Arabic blurb words
  if (/نبذة|ملخص|الوصف|عن الكتاب/.test(normalized)) return "blurb";
  return null;
}

function fallbackHeaderDetection(rawRows: RawWorkbookRow[]): HeaderDetectionResult {
  const firstNonBlank = rawRows.find((row) => !isLikelyBlankMatrixRow(row)) ?? null;
  const emptyColumns = Object.fromEntries(
    METADATA_FIELDS.map((field) => [field, { index: null, header: null, confidence: 0.25 }]),
  ) as HeaderDetectionResult["columns"];
  if (!firstNonBlank) {
    return {
      strategy: "heuristic",
      headerRowNumber: null,
      columns: emptyColumns,
      warnings: ["Workbook appears to contain no non-empty rows."],
    };
  }
  const columns = { ...emptyColumns };
  firstNonBlank.values.forEach((value, index) => {
    const matchedField = heuristicHeaderAliasMap(String(value));
    if (matchedField) {
      columns[matchedField] = { index, header: String(value), confidence: 0.6 };
    }
  });
  enrichWorkbookExportColumns(firstNonBlank.values.map((value) => String(value ?? "")), columns);
  return {
    strategy: "heuristic",
    headerRowNumber: firstNonBlank.rowNumber,
    columns,
    warnings: [],
  };
}

function buildRowObjectFromColumns(row: RawWorkbookRow, columns: HeaderDetectionResult["columns"]) {
  const source: Record<string, string> = {};
  for (const [field, config] of Object.entries(columns)) {
    if (config?.index == null) continue;
    source[field] = String(row.values[config.index] ?? "");
  }
  return source;
}

function fallbackNormalizeRows(rawRows: RawWorkbookRow[], detection: HeaderDetectionResult) {
  const headerRowNumber = detection.headerRowNumber ?? 1;
  const rows = rawRows
    .filter((row) => row.rowNumber > headerRowNumber)
    .map((row) => ({ row, source: buildRowObjectFromColumns(row, detection.columns) }))
    .filter(({ source }) => Object.values(source).some((value) => sanitizeText(value)));

  const normalizedRows: MetadataRow[] = rows.map(({ row, source }, index) => ({
    rowIndex: index + 1,
    title: sanitizeText(source.title) ?? "",
    publisher: sanitizePublisherValue(source.publisher) ?? "",
    subtitle: sanitizeText(source.subtitle),
    genre: sanitizeText(source.genre),
    blurb: sanitizeText(source.blurb),
    author: sanitizeContributorAuthor(source.author),
    isbn: sanitizeText(source.isbn),
    pubYear: sanitizePubYearValue(source.pubYear),
    sellingType: sanitizeSellingType(source.sellingType) ?? undefined,
    price: sanitizeNumberOrNull(source.price) ?? undefined,
    trackCount: sanitizeNumberOrNull(source.trackCount) ?? undefined,
    totalOriginalBookSizeBytes: sanitizeNumberOrNull(source.totalOriginalBookSizeBytes) ?? undefined,
    totalLengthSeconds: sanitizeNumberOrNull(source.totalLengthSeconds) ?? undefined,
    narrator: sanitizeText(source.narrator),
    importancePoints: sanitizeNumberOrNull(source.importancePoints) ?? undefined,
  }));

  const report: MetadataNormalizationReport = {
    mode: "heuristic",
    headerRowNumber,
    columns: detection.columns,
    rowReports: normalizedRows.map((row) => ({
      rowIndex: row.rowIndex,
      confidence: 0.5,
      missingFields: ["title", "publisher"].filter((field) => !(row as unknown as Record<string, unknown>)[field]),
      unmappedColumns: [],
      notes: [],
    })),
    warnings: detection.warnings ?? [],
  };

  return { rows: normalizedRows, report };
}

function parseAiJson<T>(value: unknown): T {
  if (typeof value === "string") return JSON.parse(value) as T;
  if (value && typeof value === "object") {
    if ("response" in value && typeof (value as { response?: unknown }).response === "string") {
      return JSON.parse((value as { response: string }).response) as T;
    }
    return value as T;
  }
  throw new Error("AI returned an unexpected response shape.");
}

function isUsableAiDetection(result: HeaderDetectionResult) {
  if (result.headerRowNumber == null || !Number.isFinite(result.headerRowNumber)) return false;
  if (result.columns["title"]?.index == null) return false;
  const mappedCount = METADATA_FIELDS.filter((field) => result.columns[field]?.index != null).length;
  return mappedCount >= 1;
}

// Converts a flat {columnLetter: fieldName} AI response into our internal column map.
function aiColumnMappingToInternal(
  headerRow: RawWorkbookRow,
  mapping: Record<string, string>,
): HeaderDetectionResult["columns"] {
  const emptyColumns = Object.fromEntries(
    METADATA_FIELDS.map((f) => [f, { index: null as number | null, header: null as string | null, confidence: 0.25 }]),
  ) as HeaderDetectionResult["columns"];
  for (const [colLetter, fieldName] of Object.entries(mapping)) {
    if (!METADATA_FIELDS.includes(fieldName as MetadataFieldName)) continue;
    const colIndex = colLetter.toUpperCase().split("").reduce((acc, ch) => acc * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    if (colIndex < 0) continue;
    const headerValue = headerRow.values[colIndex];
    emptyColumns[fieldName as MetadataFieldName] = {
      index: colIndex,
      header: headerValue != null ? String(headerValue) : null,
      confidence: 0.85,
    };
  }
  return emptyColumns;
}

async function detectWorkbookStructureWithAi(env: Env, rawRows: RawWorkbookRow[]): Promise<HeaderDetectionResult> {
  if (!env.AI) {
    return fallbackHeaderDetection(rawRows);
  }

  // Build a compact preview: header row candidates + 3 sample data rows.
  // Seeing real data values (e.g. "9789..." under a column) helps the model confirm its mapping.
  const nonBlankRows = rawRows.filter((row) => !isLikelyBlankMatrixRow(row));

  // The first non-blank row is likely the header; take up to 4 more rows as data samples.
  const previewRows = nonBlankRows.slice(0, 5).map((row) => ({
    rowNumber: row.rowNumber,
    cells: row.values.slice(0, 40).map((value, index) => ({
      col: columnLabelFromIndex(index),
      val: String(value ?? "").slice(0, 60),
    })).filter((c) => c.val),
  }));

  try {
    const result = await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast", {
      messages: [
        {
          role: "system",
          content:
            "You are a spreadsheet analysis assistant. You will receive the first few rows of a spreadsheet — one header row and a few data rows. " +
            "Use both the header text AND the data values to identify which column maps to each target field. " +
            "Column headers may be in Arabic or English. Respond ONLY with valid JSON — no markdown, no explanation.",
        },
        {
          role: "user",
          content:
            `Here are the first few rows of a spreadsheet (row 1 is likely the header, rows 2–4 are data samples).\n\n` +
            `Valid field names: ${METADATA_FIELDS.join(", ")}\n\n` +
            `Arabic header equivalents:\n` +
            `title=العنوان/اسم الكتاب, author=المؤلف, publisher=الناشر/دار النشر, narrator=الراوي, ` +
            `isbn=ISBN/ردمك (values start with 978 or 979), pubYear=سنة النشر (4-digit year), ` +
            `genre=النوع/التصنيف, blurb=نبذة/الوصف (long text), ` +
            `price=السعر (numeric), sellingType=نوع البيع, trackCount=عدد المقاطع (small integer), ` +
            `importancePoints=نقاط الأهمية\n\n` +
            `Rows:\n${JSON.stringify(previewRows, null, 2)}\n\n` +
            `Return JSON in this exact format:\n` +
            `{"headerRowNumber": 1, "mapping": {"A": "title", "B": "author", "C": "publisher"}}\n` +
            `Only include columns you are confident about. Use the column letter (A, B, C...) as the key.`,
        },
      ],
      response_format: { type: "json_object" as const },
      max_tokens: 512,
    });

    const parsed = parseAiJson<{ headerRowNumber?: number | null; mapping?: Record<string, string> }>(result);
    const headerRowNumber = typeof parsed?.headerRowNumber === "number" ? parsed.headerRowNumber : null;
    const mapping = parsed?.mapping && typeof parsed.mapping === "object" ? parsed.mapping : {};

    if (headerRowNumber == null || Object.keys(mapping).length === 0) {
      return { ...fallbackHeaderDetection(rawRows), warnings: ["AI returned no column mapping; heuristic used."] };
    }

    const headerRow = rawRows.find((r) => r.rowNumber === headerRowNumber) ?? nonBlankRows[0];
    const columns = aiColumnMappingToInternal(headerRow, mapping);

    // Merge: AI wins where it found a column, heuristic fills the rest.
    const heuristic = fallbackHeaderDetection(rawRows);
    for (const field of METADATA_FIELDS) {
      if (columns[field]?.index == null && heuristic.columns[field]?.index != null) {
        columns[field] = heuristic.columns[field];
      }
    }

    const aiDetection: HeaderDetectionResult = { strategy: "ai", headerRowNumber, columns, warnings: [] };
    if (isUsableAiDetection(aiDetection)) return aiDetection;

    // AI result unusable — fall back silently.
    return fallbackHeaderDetection(rawRows);
  } catch {
    return fallbackHeaderDetection(rawRows);
  }
}

function extractHeaderCells(rawRows: RawWorkbookRow[], headerRowNumber: number | null) {
  const headerRow = rawRows.find((r) => r.rowNumber === headerRowNumber) ?? rawRows.find((r) => !isLikelyBlankMatrixRow(r));
  if (!headerRow) return [];
  return headerRow.values
    .map((value, index) => ({ col: columnLabelFromIndex(index), index, header: String(value ?? "").trim() }))
    .filter((c) => c.header);
}

async function normalizeWorkbookRowsWithAi(
  env: Env,
  rawRows: RawWorkbookRow[],
  detection: HeaderDetectionResult,
) {
  const normalized = fallbackNormalizeRows(rawRows, detection);
  const headerCells = extractHeaderCells(rawRows, detection.headerRowNumber);
  return {
    rows: normalized.rows,
    report: {
      mode: detection.strategy,
      headerRowNumber: detection.headerRowNumber,
      columns: detection.columns,
      headerCells,
      rowReports: normalized.report.rowReports,
      warnings: normalized.report.warnings ?? [],
    },
  };
}

function groupByFolder(items: SourceManifestItem[]): Map<string, SourceManifestItem[]> {
  const groups = new Map<string, SourceManifestItem[]>();
  for (const item of items) {
    const key = item.parentPath || "__root__";
    const current = groups.get(key) ?? [];
    current.push(item);
    groups.set(key, current);
  }
  return groups;
}

function groupByTopLevelBookFolder(items: SourceManifestItem[]): Map<string, SourceManifestItem[]> {
  const groups = new Map<string, SourceManifestItem[]>();
  for (const item of items) {
    const segments = item.parentPath.split("/").filter(Boolean);
    const key = segments[0] ?? "__root__";
    const current = groups.get(key) ?? [];
    current.push(item);
    groups.set(key, current);
  }
  return groups;
}

// For Publisher/BookTitle/track.mp3 layouts — group by the second-level folder (book title)
function groupBySecondLevelBookFolder(items: SourceManifestItem[]): Map<string, SourceManifestItem[]> {
  const groups = new Map<string, SourceManifestItem[]>();
  for (const item of items) {
    const segments = item.parentPath.split("/").filter(Boolean);
    const key = segments.length >= 2 ? `${segments[0]}/${segments[1]}` : segments[0] ?? "__root__";
    const current = groups.get(key) ?? [];
    current.push(item);
    groups.set(key, current);
  }
  return groups;
}

function groupRootArchivesSeparately(items: SourceManifestItem[]): Map<string, SourceManifestItem[]> {
  const groups = new Map<string, SourceManifestItem[]>();
  const rootAudioItems = items.filter((item) => !item.parentPath && maybeAudio(item));
  const rootZipItems = items.filter((item) => !item.parentPath && maybeZip(item));
  const rootCoverItems = items.filter((item) => !item.parentPath && maybeCover(item));
  const nestedItems = items.filter((item) => item.parentPath);

  for (const item of rootZipItems) {
    groups.set(item.key, [item, ...rootCoverItems.filter((cover) => similarity(cover.name, item.name) > 0.1)]);
  }

  if (rootAudioItems.length > 0) {
    groups.set("__root_audio__", [...rootAudioItems, ...rootCoverItems]);
  }

  for (const item of nestedItems) {
    const key = item.parentPath;
    const current = groups.get(key) ?? [];
    current.push(item);
    groups.set(key, current);
  }

  return groups;
}

export function buildNormalizedGroups(manifest: SourceManifestItem[]): NormalizedGroup[] {
  // Exclude items extracted from ZIPs — the ZIP itself already represents that group.
  const sourceItems = manifest.filter((item) => !item.extractedFromKey);
  const relevantItems = sourceItems.filter((item) => maybeAudio(item) || maybeZip(item) || maybeCover(item));
  const audioItems = relevantItems.filter((item) => maybeAudio(item));
  const maxAudioDepth = audioItems.length > 0
    ? Math.max(...audioItems.map((item) => item.parentPath.split("/").filter(Boolean).length))
    : 0;
  const hasDeepNestedAudio = maxAudioDepth >= 2;
  const hasNestedFolders = relevantItems.some((item) => item.parentPath.split("/").filter(Boolean).length >= 1);
  const multipleRootArchives = relevantItems.filter((item) => !item.parentPath && maybeZip(item)).length > 1;
  const folderGroups = hasDeepNestedAudio
    ? groupBySecondLevelBookFolder(relevantItems)
    : hasNestedFolders
      ? groupByTopLevelBookFolder(relevantItems)
      : multipleRootArchives
        ? groupRootArchivesSeparately(relevantItems)
        : groupByFolder(relevantItems);
  const groups: NormalizedGroup[] = [];
  for (const [folderKey, items] of folderGroups.entries()) {
    const audioItems = items.filter((item) => maybeAudio(item) || maybeZip(item));
    if (audioItems.length === 0) continue;
    const displayName =
      folderKey === "__root__"
        ? audioItems[0]?.name ?? "root"
        : folderKey === "__root_audio__"
          ? "Root audio files"
          : folderKey.split("/").pop() ?? folderKey;
    const nestedPathCount = new Set(items.map((item) => item.parentPath).filter(Boolean)).size;
    const groupedFromSubfolders = hasNestedFolders && folderKey !== "__root__" && nestedPathCount > 1;
    const groupedRootArchives = multipleRootArchives && folderKey !== "__root_audio__" && maybeZip(audioItems[0]!);
    groups.push({
      groupKey: folderKey === "__root__" ? slugify(displayName) || crypto.randomUUID() : slugify(folderKey),
      displayName,
      inferredTitle: displayName.replace(/\.(zip|mp3|m4a|wav)$/i, ""),
      items: naturalSort(audioItems, (item) => item.name),
      coverCandidates: items.filter(maybeCover),
      confidence: groupedRootArchives ? 0.88 : audioItems.some(maybeZip) ? 0.78 : groupedFromSubfolders ? 0.81 : 0.66,
      reasons: groupedRootArchives
        ? ["Grouped each root archive as its own audiobook candidate"]
        : audioItems.some(maybeZip)
        ? ["Found archive-based audio package"]
        : groupedFromSubfolders
          ? ["Grouped by top-level book folder across nested subfolders"]
          : ["Grouped by folder path"],
    });
  }
  return groups.sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { numeric: true }));
}

function groupScore(metadata: MetadataRow, group: NormalizedGroup): number {
  const titleScore = Math.max(similarity(metadata.title, group.inferredTitle), similarity(metadata.title, group.displayName));
  const authorScore = metadata.author ? Math.max(...group.items.map((item) => similarity(metadata.author ?? "", item.name)), 0) * 0.08 : 0;
  const narratorScore = metadata.narrator ? Math.max(...group.items.map((item) => similarity(metadata.narrator ?? "", item.name)), 0) * 0.05 : 0;
  const audioWeight = group.items.some((item) => maybeAudio(item)) ? 0.15 : 0;
  const zipPenalty = group.items.every((item) => maybeZip(item)) ? -0.05 : 0;
  return titleScore + authorScore + narratorScore + audioWeight + zipPenalty;
}

function assignGroupsToMetadataRows(metadataRows: MetadataRow[], groups: NormalizedGroup[]) {
  const candidates = metadataRows.flatMap((metadata) =>
    groups.map((group) => ({
      rowIndex: metadata.rowIndex,
      groupKey: group.groupKey,
      score: groupScore(metadata, group),
    })),
  );
  candidates.sort((a, b) => b.score - a.score);
  const assignedRows = new Set<number>();
  const assignedGroups = new Set<string>();
  const assignments = new Map<number, NormalizedGroup>();
  for (const candidate of candidates) {
    if (candidate.score < 0.18) continue;
    if (assignedRows.has(candidate.rowIndex) || assignedGroups.has(candidate.groupKey)) continue;
    const group = groups.find((entry) => entry.groupKey === candidate.groupKey);
    if (!group) continue;
    assignments.set(candidate.rowIndex, group);
    assignedRows.add(candidate.rowIndex);
    assignedGroups.add(candidate.groupKey);
  }
  return {
    assignments,
    unmatchedGroups: groups.filter((group) => !assignedGroups.has(group.groupKey)),
  };
}

async function expandZipEntries(env: Env, repo: Repository, batchId: string, manifest: SourceManifestItem[]) {
  const derived: SourceManifestItem[] = [];
  const archives = manifest.filter(maybeZip);
  const deferredArchives: Array<{ key: string; name: string; reason: string }> = [];
  const maxInlineArchiveBytes = 64 * 1024 * 1024;
  let extractedArchives = 0;
  let extractedEntries = 0;
  const progress = createProgressWriter(repo, batchId);
  for (const item of archives) {
    await progress.log(`Starting archive extraction: ${item.name}`, { force: true });
    await progress.update({
      phase: "extracting_archives",
      currentItem: item.name,
      totalArchives: archives.length,
      extractedArchives,
      extractedEntries,
    }, { force: true });
    if (item.sizeBytes > maxInlineArchiveBytes) {
      const reason = `Archive exceeds Worker inline extraction limit (${Math.round(item.sizeBytes / 1024 / 1024)} MB > ${Math.round(maxInlineArchiveBytes / 1024 / 1024)} MB).`;
      deferredArchives.push({ key: item.key, name: item.name, reason });
      await progress.log(`Deferred archive extraction: ${item.name} -> ${reason}`, { level: "warn", force: true });
      continue;
    }
    const object = await env.ASSET_BUCKET.get(item.key);
    if (!object) continue;
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(await object.arrayBuffer());
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      deferredArchives.push({ key: item.key, name: item.name, reason });
      await progress.log(`Deferred archive extraction: ${item.name} -> ${reason}`, { level: "warn", force: true });
      continue;
    }
    const archiveSlug = slugify(item.name.replace(/\.zip$/i, "")) || "archive";
    for (const [entryName, entry] of Object.entries(zip.files)) {
      if (entry.dir) continue;
      const content = await entry.async("uint8array");
      const derivedKey = keySegments("ingestions", batchId, "working", archiveSlug, entryName);
      await env.ASSET_BUCKET.put(derivedKey, content);
      derived.push({
        key: derivedKey,
        name: entryName.split("/").pop() ?? entryName,
        mimeType: /\.mp3$/i.test(entryName) ? "audio/mpeg" : "application/octet-stream",
        sizeBytes: content.byteLength,
        parentPath: archiveSlug,
        extractedFromKey: item.key,
      });
      extractedEntries += 1;
      await progress.update({
        phase: "extracting_archives",
        currentItem: `${item.name} -> ${entryName}`,
        totalArchives: archives.length,
        extractedArchives,
        extractedEntries,
      });
    }
    extractedArchives += 1;
    await progress.log(`Archive extracted: ${item.name} (${extractedEntries} entries total)`, { force: true });
    await progress.update({
      phase: "extracting_archives",
      currentItem: item.name,
      totalArchives: archives.length,
      extractedArchives,
      extractedEntries,
    }, { force: true });
  }
  await progress.flush();
  return { derived, deferredArchives };
}

async function writeIntakeProgress(
  repo: Repository,
  batchId: string,
  patch: Record<string, unknown>,
  status: "intake_queued" | "normalizing" | "intake_failed" | "normalized" = "normalizing",
) {
  const current = await repo.getBatch(batchId);
  if (!current) return;
  const appendedLogs = Array.isArray(patch.intakeLogsAppend) ? (patch.intakeLogsAppend as unknown[]) : [];
  const nextLogs = ([...(((current.normalization?.intakeLogs as unknown[]) ?? [])), ...appendedLogs]).slice(-200);
  const progressPatch = { ...patch };
  delete progressPatch.intakeLogsAppend;
  await repo.updateBatch(batchId, {
    status,
    normalization: {
      ...(current.normalization ?? {}),
      intakeLogs: nextLogs,
      intakeProgress: {
        ...((current.normalization?.intakeProgress as Record<string, unknown> | undefined) ?? {}),
        ...progressPatch,
        updatedAt: nowIso(),
      },
    },
  });
}

function createProgressWriter(repo: Repository, batchId: string) {
  let pendingPatch: Record<string, unknown> = {};
  let pendingLogs: Array<Record<string, unknown>> = [];
  let lastFlushAt = 0;
  let writeChain: Promise<void> = Promise.resolve();

  const flushPatch = async (status: "intake_queued" | "normalizing" | "intake_failed" | "normalized") => {
    const patch = {
      ...pendingPatch,
      intakeLogsAppend: pendingLogs,
    };
    pendingPatch = {};
    pendingLogs = [];
    lastFlushAt = Date.now();
    writeChain = writeChain.then(() => writeIntakeProgress(repo, batchId, patch, status));
    await writeChain;
  };

  return {
    async update(
      patch: Record<string, unknown>,
      options?: { force?: boolean; status?: "intake_queued" | "normalizing" | "intake_failed" | "normalized" },
    ) {
      pendingPatch = { ...pendingPatch, ...patch };
      const force = options?.force ?? false;
      const status = options?.status ?? "normalizing";
      if (force || Date.now() - lastFlushAt >= 1500) {
        await flushPatch(status);
      }
    },
    async log(message: string, options?: { level?: "info" | "warn" | "error"; force?: boolean }) {
      pendingLogs.push({
        at: nowIso(),
        level: options?.level ?? "info",
        message,
      });
      if (options?.force || Date.now() - lastFlushAt >= 1500) {
        await flushPatch("normalizing");
      }
    },
    async flush(status: "intake_queued" | "normalizing" | "intake_failed" | "normalized" = "normalizing") {
      if (Object.keys(pendingPatch).length > 0 || pendingLogs.length > 0) {
        await flushPatch(status);
      } else {
        await writeChain;
      }
    },
  };
}

async function getSkipRequests(repo: Repository, batchId: string): Promise<string[]> {
  const batch = await repo.getBatch(batchId);
  const requests = batch?.normalization?.skipRequests;
  return Array.isArray(requests) ? requests.map((value) => String(value)) : [];
}

async function clearSkipRequest(repo: Repository, batchId: string, key: string) {
  const batch = await repo.getBatch(batchId);
  if (!batch) return;
  const existing = Array.isArray(batch.normalization?.skipRequests) ? batch.normalization.skipRequests.map((value) => String(value)) : [];
  if (!existing.includes(key)) return;
  await repo.updateBatch(batchId, {
    normalization: {
      ...(batch.normalization ?? {}),
      skipRequests: existing.filter((entry) => entry !== key),
    },
  });
}

export async function normalizeDriveIntake(env: Env, repo: Repository, batchId: string) {
  const batch = await repo.getBatch(batchId);
  if (!batch || !batch.driveLink) return;
  const ingestionBatchId = batch.id;
  const progress = createProgressWriter(repo, batchId);
  const activeTransfers = new Map<string, { name: string; sizeBytes: number; downloadedBytes: number }>();

  function transferSnapshot() {
    return [...activeTransfers.entries()]
      .map(([key, value]) => ({
        key,
        name: value.name,
        sizeBytes: value.sizeBytes,
        downloadedBytes: value.downloadedBytes,
        progressPercent: value.sizeBytes > 0 ? Math.min(100, Math.round((value.downloadedBytes / value.sizeBytes) * 100)) : 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  const existingProgress = ((batch.normalization?.intakeProgress as Record<string, unknown> | undefined) ?? {});
  const shouldCheckExisting = (Number(existingProgress.copiedSourceFiles ?? 0)) > 0;

  await progress.update({
    phase: "authorizing_drive",
    // On a fresh start reset all counters; on a resume keep the existing values so the
    // UI doesn't flash back to zero while already-uploaded files are being re-verified.
    ...(shouldCheckExisting ? {} : {
      copiedSourceFiles: 0,
      copiedSourceBytes: 0,
      totalSourceFiles: 0,
      totalSourceBytes: 0,
    }),
    extractedEntries: 0,
    totalArchives: 0,
    extractedArchives: 0,
    currentItem: null,
    activeTransfers: [],
  }, { force: true });
  await progress.log("Authorizing Google Drive access", { force: true });
  const token = await getServiceAccountToken(env);
  await progress.update({
    phase: "listing_drive",
  }, { force: true });
  await progress.log("Listing files from Google Drive", { force: true });
  const driveItems = await listDriveFiles(env, batch.driveLink, token, true, async ({ filesFound, foldersVisited, currentFolder }) => {
    await progress.update({
      listingFilesFound: filesFound,
      listingFoldersVisited: foldersVisited,
      listingCurrentFolder: currentFolder,
    });
  });
  const manifest: SourceManifestItem[] = [];
  const downloadErrors: string[] = [];
  const totalSourceFiles = driveItems.length;
  const totalSourceBytes = driveItems.reduce((sum, item) => sum + item.sizeBytes, 0);
  let copiedSourceFiles = 0;
  let copiedSourceBytes = 0;

  await progress.update({
    phase: "copying_source_files",
    totalSourceFiles,
    totalSourceBytes,
    // On resume, preserve the existing byte/file counts so the bar stays where it was
    // while already-uploaded files are quickly re-verified and the counter catches up.
    ...(shouldCheckExisting ? {} : { copiedSourceFiles: 0, copiedSourceBytes: 0 }),
  }, { force: true });
  await progress.log(`Discovered ${totalSourceFiles} source files (${Math.round(totalSourceBytes / 1024 / 1024)} MB total)`, { force: true });

  const concurrency = chooseCopyConcurrency(driveItems);
  let nextIndex = 0;
  const manifestBuckets: SourceManifestItem[][] = Array.from({ length: concurrency }, () => []);

  async function copyOne(item: SourceManifestItem): Promise<SourceManifestItem | null> {
    const key = buildDriveSourceObjectKey(ingestionBatchId, item);
    if (shouldCheckExisting) {
      const existing = await env.ASSET_BUCKET.head(key);
      if (existing && (item.sizeBytes <= 0 || existing.size === item.sizeBytes)) {
        return { ...item, key };
      }
      if (existing) {
        await env.ASSET_BUCKET.delete(key).catch(() => undefined);
      }
    }
    const maxAttempts = item.sizeBytes >= 512 * 1024 * 1024 ? 5 : 4;
    const idleTimeoutMs = chooseIdleTimeoutMs(item);

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let skipRequested = false;
      let stopSkipWatcher = false;
      const skipWatcher = (async () => {
        while (!stopSkipWatcher) {
          const skipRequests = await getSkipRequests(repo, batchId);
          if (skipRequests.includes(key)) {
            skipRequested = true;
            return;
          }
          await sleep(500);
        }
      })();

      const controller = new AbortController();
      const fetchTimeoutId = setTimeout(() => controller.abort(new Error("fetch_timeout")), 60_000);
      activeTransfers.set(key, {
        name: item.name,
        sizeBytes: item.sizeBytes,
        downloadedBytes: 0,
      });
      await progress.update({
        activeTransfers: transferSnapshot(),
        currentItem: item.name,
      }, { force: true });
      if (attempt === 1 && item.sizeBytes >= 128 * 1024 * 1024) {
        await progress.log(
          `Starting protected large-file transfer: ${item.name} (${Math.round(item.sizeBytes / 1024 / 1024)} MB)`,
          { force: true },
        );
      }

      let lastTransferFlush = 0;
      try {
        const response = await fetch(
          `${env.GOOGLE_DRIVE_API_BASE_URL}/files/${item.key}?alt=media&supportsAllDrives=true`,
          {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
          },
        );
        clearTimeout(fetchTimeoutId);
        if (!response.ok) {
          throw new Error(`Failed to download Drive file ${item.key}: ${response.status}`);
        }
        if (!response.body) {
          throw new Error(`Drive response body missing for ${item.name}`);
        }
        const contentType = response.headers.get("content-type") ?? "";
        if (contentType.includes("application/json") || contentType.includes("text/html")) {
          const preview = await response.text();
          throw new Error(`Drive returned non-binary response for ${item.name} (content-type: ${contentType}): ${preview.slice(0, 200)}`);
        }

        const contentLengthHeader = response.headers.get("content-length");
        const contentLength = Number(contentLengthHeader ?? item.sizeBytes);
        if (Number.isFinite(contentLength) && contentLength > 0) {
          const fixedLengthStream = new FixedLengthStream(contentLength);
          const reader = response.body.getReader();
          const writer = fixedLengthStream.writable.getWriter();
          const pipePromise = (async () => {
            try {
              while (true) {
                if (skipRequested) throw new Error("skip_requested");
                const { done, value } = await readWithIdleTimeout(reader, idleTimeoutMs);
                if (done) break;
                if (skipRequested) throw new Error("skip_requested");
                if (value) {
                  await writer.write(value);
                  const current = activeTransfers.get(key);
                  if (current) {
                    current.downloadedBytes += value.byteLength;
                    const now = Date.now();
                    if (now - lastTransferFlush >= 400 || current.downloadedBytes >= current.sizeBytes) {
                      lastTransferFlush = now;
                      await progress.update({
                        activeTransfers: transferSnapshot(),
                        currentItem: item.name,
                      });
                    }
                  }
                }
              }
              await writer.close();
            } catch (error) {
              await reader.cancel(error instanceof Error ? error.message : String(error)).catch(() => undefined);
              await writer.abort(error).catch(() => undefined);
              throw error;
            }
          })();
          const putPromise = env.ASSET_BUCKET.put(key, fixedLengthStream.readable, {
            httpMetadata: { contentType: item.mimeType },
          });
          await Promise.all([pipePromise, putPromise]);
        } else {
          const reader = response.body.getReader();
          const passthrough = new TransformStream<Uint8Array, Uint8Array>();
          const writer = passthrough.writable.getWriter();
          const pipePromise = (async () => {
            try {
              while (true) {
                if (skipRequested) throw new Error("skip_requested");
                const { done, value } = await readWithIdleTimeout(reader, idleTimeoutMs);
                if (done) break;
                if (skipRequested) throw new Error("skip_requested");
                if (value) {
                  await writer.write(value);
                  const current = activeTransfers.get(key);
                  if (current) {
                    current.downloadedBytes += value.byteLength;
                    const now = Date.now();
                    if (now - lastTransferFlush >= 400 || current.downloadedBytes >= current.sizeBytes) {
                      lastTransferFlush = now;
                      await progress.update({
                        activeTransfers: transferSnapshot(),
                        currentItem: item.name,
                      });
                    }
                  }
                }
              }
              await writer.close();
            } catch (error) {
              await reader.cancel(error instanceof Error ? error.message : String(error)).catch(() => undefined);
              await writer.abort(error).catch(() => undefined);
              throw error;
            }
          })();
          const putPromise = env.ASSET_BUCKET.put(key, passthrough.readable, {
            httpMetadata: { contentType: item.mimeType },
          });
          await Promise.all([pipePromise, putPromise]);
        }
        return { ...item, key };
      } catch (error) {
        clearTimeout(fetchTimeoutId);
        controller.abort();
        await env.ASSET_BUCKET.delete(key).catch(() => undefined);
        if (skipRequested) {
          throw error;
        }
        const retryable = isRetryableCopyError(error);
        if (retryable && attempt < maxAttempts) {
          await progress.log(
            `Retrying large-file copy: ${item.name} (attempt ${attempt + 1}/${maxAttempts}) after ${error instanceof Error ? error.message : String(error)}`,
            { level: "warn", force: true },
          );
          await sleep(Math.min(10_000, attempt * 2_000));
          continue;
        }
        throw error;
      } finally {
        clearTimeout(fetchTimeoutId);
        stopSkipWatcher = true;
        await skipWatcher.catch(() => undefined);
        activeTransfers.delete(key);
        await progress.update({
          activeTransfers: transferSnapshot(),
          currentItem: item.name,
        }, { force: true });
      }
    }
    throw new Error(`Drive copy exhausted retries for ${item.name}`);
  }

  await Promise.all(
    manifestBuckets.map(async (bucket) => {
      while (true) {
        const currentIndex = nextIndex++;
        if (currentIndex >= driveItems.length) break;
        const item = driveItems[currentIndex];
        try {
          const copied = await copyOne(item);
          if (copied) {
            bucket.push(copied);
            copiedSourceFiles += 1;
            copiedSourceBytes += item.sizeBytes;
          }
        } catch (err) {
          const skipRequests = await getSkipRequests(repo, batchId);
          const key = buildDriveSourceObjectKey(ingestionBatchId, item);
          if (skipRequests.includes(key)) {
            await clearSkipRequest(repo, batchId, key);
            await progress.log(`Skipped file by operator request: ${item.name}`, { level: "warn", force: true });
            await progress.update({
              phase: "copying_source_files",
              currentItem: item.name,
              activeTransfers: transferSnapshot(),
            }, { force: true });
            continue;
          }
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`Skipping ${item.name}: ${msg}`);
          downloadErrors.push(`${item.name}: ${msg}`);
          await progress.log(`Copy failed: ${item.name} -> ${msg}`, { level: "warn" });
          await progress.update({
            phase: "copying_source_files",
            currentItem: item.name,
            lastError: msg,
            totalSourceFiles,
            totalSourceBytes,
            copiedSourceFiles,
            copiedSourceBytes,
          });
          continue;
        }
        await progress.update({
          phase: "copying_source_files",
          currentItem: item.name,
          totalSourceFiles,
          totalSourceBytes,
          copiedSourceFiles,
          copiedSourceBytes,
        });
        if (copiedSourceFiles === 1 || copiedSourceFiles % 10 === 0 || copiedSourceFiles === totalSourceFiles) {
          await progress.log(`Copied ${copiedSourceFiles}/${totalSourceFiles} files`);
        }
      }
    }),
  );

  manifest.push(...manifestBuckets.flat().sort((a, b) => a.key.localeCompare(b.key)));
  await progress.flush();

  if (manifest.length === 0 && driveItems.length > 0) {
    throw new Error(
      `All ${driveItems.length} files failed to download. First error: ${downloadErrors[0] ?? "unknown"}`,
    );
  }

  await progress.update({
    phase: "extracting_archives",
    currentItem: null,
    totalArchives: manifest.filter(maybeZip).length,
    extractedArchives: 0,
    extractedEntries: 0,
    totalSourceFiles,
    totalSourceBytes,
    copiedSourceFiles,
    copiedSourceBytes,
  }, { force: true });
  await progress.log(`Copy complete. Starting archive extraction for ${manifest.filter(maybeZip).length} zip files.`, { force: true });
  const { derived: expanded, deferredArchives } = await expandZipEntries(env, repo, batch.id, manifest);
  const fullManifest = [...manifest, ...expanded];
  const groups = buildNormalizedGroups(fullManifest);
  const retainedMetadataSheetObjectKey = batch.metadataSheetObjectKey;
  await progress.log(`Normalization complete. ${groups.length} candidate groups detected.`, { force: true });
  await repo.updateBatch(batchId, {
    sourceManifest: fullManifest,
    metadataSheetObjectKey: retainedMetadataSheetObjectKey,
    intakeMode: inferIntakeMode(fullManifest),
    normalization: {
      ...(batch.normalization ?? {}),
      groups,
      deferredArchives,
      intakeProgress: {
        phase: "completed",
        totalSourceFiles,
        totalSourceBytes,
        copiedSourceFiles,
        copiedSourceBytes,
        totalArchives: manifest.filter(maybeZip).length,
        extractedArchives: manifest.filter(maybeZip).length,
        extractedEntries: expanded.length,
        currentItem: null,
        activeTransfers: [],
        updatedAt: nowIso(),
      },
    },
    status: retainedMetadataSheetObjectKey ? "metadata_sheet_selected" : "metadata_sheet_pending",
  });
}

export async function normalizeUploadedBatch(env: Env, repo: Repository, batch: IngestionBatchRecord, manifest: SourceManifestItem[]) {
  const progress = createProgressWriter(repo, batch.id);
  const totalSourceFiles = manifest.length;
  const totalSourceBytes = manifest.reduce((sum, item) => sum + item.sizeBytes, 0);
  await progress.update({
    phase: "upload_received",
    totalSourceFiles,
    copiedSourceFiles: totalSourceFiles,
    totalSourceBytes,
    copiedSourceBytes: totalSourceBytes,
    totalArchives: manifest.filter(maybeZip).length,
    extractedArchives: 0,
    extractedEntries: 0,
    currentItem: manifest[0]?.name ?? null,
    activeTransfers: [],
  }, { force: true });
  await progress.log(`Uploaded source received: ${manifest[0]?.name ?? "uploaded file"}`, { force: true });
  await progress.update({
    phase: "extracting_archives",
    currentItem: null,
    totalArchives: manifest.filter(maybeZip).length,
    extractedArchives: 0,
    extractedEntries: 0,
    totalSourceFiles,
    totalSourceBytes,
    copiedSourceFiles: totalSourceFiles,
    copiedSourceBytes: totalSourceBytes,
    activeTransfers: [],
  }, { force: true });
  await progress.log(`Starting normalization for uploaded source. ${manifest.filter(maybeZip).length} zip files detected.`, { force: true });
  const { derived: expanded, deferredArchives } = await expandZipEntries(env, repo, batch.id, manifest);
  const fullManifest = [...manifest, ...expanded];
  const groups = buildNormalizedGroups(fullManifest);
  const retainedMetadataSheetObjectKey = batch.metadataSheetObjectKey;
  const existingMetadataRows = Array.isArray(batch.normalization?.metadataRows)
    ? (batch.normalization.metadataRows as MetadataRow[])
    : [];
  await progress.log(`Normalization complete. ${groups.length} candidate groups detected.`, { force: true });
  await progress.flush("normalized");
  await repo.updateBatch(batch.id, {
    sourceManifest: fullManifest,
    metadataSheetObjectKey: retainedMetadataSheetObjectKey,
    intakeMode: inferIntakeMode(fullManifest),
    normalization: {
      ...(batch.normalization ?? {}),
      groups,
      deferredArchives,
      intakeProgress: {
        phase: "completed",
        totalSourceFiles,
        copiedSourceFiles: totalSourceFiles,
        totalSourceBytes,
        copiedSourceBytes: totalSourceBytes,
        totalArchives: manifest.filter(maybeZip).length,
        extractedArchives: manifest.filter(maybeZip).length,
        extractedEntries: expanded.length,
        currentItem: null,
        activeTransfers: [],
        updatedAt: nowIso(),
      },
    },
    status: existingMetadataRows.length > 0
      ? "metadata_parsed"
      : retainedMetadataSheetObjectKey
        ? "metadata_sheet_selected"
        : "metadata_sheet_pending",
  });
}

export async function parseBatchMetadata(env: Env, repo: Repository, batchId: string) {
  const batch = await repo.getBatch(batchId);
  if (!batch) return;
  if (!batch.metadataSheetObjectKey) {
    throw new Error("Select or upload a metadata sheet before parsing.");
  }
  const fileName = batch.metadataSheetObjectKey.split("/").pop() ?? "metadata.xlsx";

  // Fetch the file from R2 directly in the worker and stream it to the container as multipart,
  // so the container never needs to make an outbound HTTP request (which would be blocked by CF Access).
  const r2Object = await env.ASSET_BUCKET.get(batch.metadataSheetObjectKey);
  if (!r2Object) {
    throw new Error("Metadata sheet not found in storage. Please re-upload the file.");
  }
  const fileBytes = await r2Object.arrayBuffer();

  const container = getContainer<AudioProcessorContainer>(env.AUDIO_PROCESSOR_CONTAINER, `metadata-${batchId}`);
  const response = await container.fetch(
    new Request("http://container/parse-workbook", {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-File-Name": fileName,
      },
      body: fileBytes,
    }),
  );
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Container workbook parsing failed: ${response.status} — ${body}`);
  }
  const payload = await response.json() as { rawRows?: RawWorkbookRow[] };
  const rawRows = Array.isArray(payload.rawRows) ? payload.rawRows : [];
  const headerDetection = await detectWorkbookStructureWithAi(env, rawRows);
  const normalized = await normalizeWorkbookRowsWithAi(env, rawRows, headerDetection);

  await repo.updateBatch(batchId, {
    status: "metadata_parsed",
    normalization: {
      ...batch.normalization,
      metadataParseError: undefined,
      rawWorkbookRows: rawRows,
      metadataRows: normalized.rows,
      metadataNormalizationReport: normalized.report,
    },
  });
  await repo.audit("ingestion_batch", batchId, "metadata.parse.completed", "system", {
    rowCount: normalized.rows.length,
    mode: normalized.report.mode,
  });
}

export async function generateCandidates(env: Env, repo: Repository, batchId: string) {
  const batch = await repo.getBatch(batchId);
  if (!batch || !batch.sellerId) throw new Error("Seller must be locked before reconciliation.");
  const metadataRows = (batch.normalization.metadataRows ?? []) as MetadataRow[];
  const groups = (batch.normalization.groups ?? []) as NormalizedGroup[];
  const { assignments, unmatchedGroups } = assignGroupsToMetadataRows(metadataRows, groups);

  const rows: CandidateRecord[] = [];
  for (const metadata of metadataRows) {
    const sourceGroup = assignments.get(metadata.rowIndex) ?? null;
    const samawyCandidates = await lookupSamawyCandidates(env, batch.sellerId, metadata);
    rows.push({
      id: crypto.randomUUID(),
      batchId,
      metadataRowIndex: metadata.rowIndex,
      title: metadata.title,
      author: metadata.author ?? null,
      subtitle: metadata.subtitle ?? null,
      isbn: metadata.isbn ?? null,
      narrator: metadata.narrator ?? null,
      sourceGroupKey: sourceGroup?.groupKey ?? null,
      sourceGroup,
      samawyCandidates,
      classificationDecision: null,
      decisionReason: null,
      status: "pending",
      metadataOverride: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
  }

  for (const group of unmatchedGroups) {
    const samawyCandidates = await lookupSamawyCandidates(env, batch.sellerId, {
      rowIndex: 0,
      title: group.inferredTitle || group.displayName,
      publisher: batch.sellerName ?? "",
    });
    rows.push({
      id: crypto.randomUUID(),
      batchId,
      metadataRowIndex: null,
      title: group.inferredTitle || group.displayName,
      author: null,
      subtitle: null,
      isbn: null,
      narrator: null,
      sourceGroupKey: group.groupKey,
      sourceGroup: group,
      samawyCandidates,
      classificationDecision: null,
      decisionReason: "Auto-generated from an unmatched detected source group.",
      status: "pending",
      metadataOverride: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
  }

  await repo.replaceCandidates(batchId, rows);
  await repo.updateBatch(batchId, { status: "reconciliation_in_review" });
  await repo.audit("ingestion_batch", batchId, "reconciliation.generated", "system", {
    candidateCount: rows.length,
  });
  return rows;
}

function decisionToRecordDecision(decision: CandidateDecision): "existing" | "new" {
  return decision === "approved_existing" ? "existing" : "new";
}

export async function materializeApprovedBooks(repo: Repository, batchId: string, actor = "system") {
  const batch = await repo.getBatch(batchId);
  if (!batch || !batch.sellerId || !batch.sellerName) throw new Error("Batch seller is not locked.");
  const candidates = await repo.listCandidates(batchId);
  const metadataRows = (batch.normalization.metadataRows ?? []) as MetadataRow[];
  const approved = candidates.filter(
    (candidate) => candidate.classificationDecision === "approved_existing" || candidate.classificationDecision === "approved_new",
  );

  for (const candidate of approved) {
    const existing = (await repo.listAudiobooks()).find((book) => book.candidateId === candidate.id);
    if (existing) continue;
    const metadataRow = candidate.metadataRowIndex == null ? undefined : metadataRows.find((row) => row.rowIndex === candidate.metadataRowIndex);
    const ov = candidate.metadataOverride ?? {};
    const directAudioCount = candidate.sourceGroup?.items.filter(maybeAudio).length ?? 0;
    const archiveCount = candidate.sourceGroup?.items.filter(maybeZip).length ?? 0;
    const metadataSnapshot = buildCanonicalMetadataSnapshot({
      batch,
      candidate,
      metadataRow,
      sourceGroup: candidate.sourceGroup,
    });
    const storageBasePath = buildCatalogStorageBasePath({
      publisherId: batch.sellerId,
      publisherName: batch.sellerName,
      isbn: ov.isbn ?? candidate.isbn ?? metadataRow?.isbn ?? null,
      title: ov.title ?? candidate.title,
    });
    await repo.createAudiobook({
      id: crypto.randomUUID(),
      batchId,
      candidateId: candidate.id,
      publisherId: batch.sellerId,
      publisherName: batch.sellerName,
      title: ov.title ?? candidate.title,
      subtitle: ov.subtitle ?? candidate.subtitle ?? metadataRow?.subtitle ?? null,
      genre: ov.genre ?? metadataRow?.genre ?? null,
      blurb: ov.blurb ?? metadataRow?.blurb ?? null,
      author: ov.author ?? candidate.author ?? metadataRow?.author ?? null,
      narrator: ov.narrator ?? candidate.narrator ?? metadataRow?.narrator ?? null,
      isbn: ov.isbn ?? candidate.isbn ?? metadataRow?.isbn ?? null,
      pubYear: ov.pubYear ?? metadataRow?.pubYear ?? null,
      sellingType: ov.sellingType ?? metadataRow?.sellingType ?? null,
      price: ov.price ?? metadataRow?.price ?? null,
      trackCount: directAudioCount || ov.trackCount || metadataRow?.trackCount || archiveCount,
      totalLengthSeconds: metadataRow?.totalLengthSeconds ?? 0,
      totalOriginalSizeBytes: metadataRow?.totalOriginalBookSizeBytes ?? (candidate.sourceGroup?.items.reduce((sum, item) => sum + item.sizeBytes, 0) ?? 0),
      totalFinalSizeBytes: 0,
      mp3SpecsSummary: {},
      sourceDriveLink: batch.driveLink,
      importancePoints: ov.importancePoints ?? metadataRow?.importancePoints ?? 0,
      classificationDecision: decisionToRecordDecision(candidate.classificationDecision!),
      metadataSnapshot,
      storageBasePath,
      coverStatus: candidate.sourceGroup?.coverCandidates.length ? "found" : "missing",
      coverObjectKey: candidate.sourceGroup?.coverCandidates[0]?.key ?? null,
      dossierStatus: "pending",
      dossierWorkbookKey: null,
      dossierAudioZipKey: null,
      clickupTaskId: null,
      clickupTaskUrl: null,
      clickupSyncStatus: "never_synced",
      clickupSyncError: null,
      clickupSyncedAt: null,
      sampleTrackId: null,
      sampleStartSeconds: null,
      sampleEndSeconds: null,
      sampleObjectKey: null,
      sampleGeneratedAt: null,
      storageCleanupStatus: "pending",
      storageCleanupError: null,
      processingStatus: "pending",
    });
  }

  await repo.updateBatch(batchId, { status: "records_created" });
  await repo.audit("ingestion_batch", batchId, "records.materialized", actor, { approvedCount: approved.length });
}

export async function buildTrackDrafts(repo: Repository, audiobook: AudiobookRecord, candidate: CandidateRecord): Promise<TrackDraft[]> {
  const items = candidate.sourceGroup?.items.filter(maybeAudio) ?? [];
  return naturalSort(items, (item) => item.name).map((item, index) => ({
    sourceType: "direct_audio",
    originalObjectKey: item.key,
    originalFilename: item.name,
    originalDetectedTitle: item.name.replace(/\.[a-z0-9]+$/i, ""),
    originalOrderIndex: index + 1,
    titleProvenance: "filename",
    proposedTitle: item.name.replace(/\.[a-z0-9]+$/i, ""),
  }));
}

export async function createUploadUrl(env: Env, key: string, contentType: string) {
  const signer = createR2Signer(env);
  if (!signer || !env.R2_ACCOUNT_ID) return { uploadUrl: `/api/local-upload/${encodeURIComponent(key)}` };
  const url = new URL(`https://${env.SOURCE_BUCKET_NAME}.${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${key}`);
  url.searchParams.set("X-Amz-Expires", "3600");
  const signed = await signer.sign(new Request(url, { method: "PUT", headers: { "Content-Type": contentType } }), {
    aws: { signQuery: true },
  });
  return { uploadUrl: signed.url };
}

export async function writeIntakeReport(env: Env, repo: Repository, batchId: string) {
  const batch = await repo.getBatch(batchId);
  if (!batch) throw new Error("Batch not found.");
  const candidates = await repo.listCandidates(batchId);
  const workbook = XLSX.utils.book_new();
  const summary = [
    { key: "batch_id", value: batch.id },
    { key: "seller_name", value: batch.sellerName ?? "" },
    { key: "status", value: batch.status },
    { key: "intake_mode", value: batch.intakeMode ?? "" },
    { key: "generated_at", value: nowIso() },
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summary), "Summary");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(batch.sourceManifest), "Source Tree");
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet((batch.normalization.metadataRows ?? []) as MetadataRow[]),
    "Metadata Rows",
  );
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet((batch.normalization.groups ?? []) as NormalizedGroup[]), "File Groups");
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(
      candidates.map((candidate) => ({
        candidateId: candidate.id,
        title: candidate.title,
        sourceGroupKey: candidate.sourceGroupKey,
        decision: candidate.classificationDecision ?? "",
        reason: candidate.decisionReason ?? "",
      })),
    ),
    "Reconciliation",
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(
      candidates.flatMap((candidate) =>
        candidate.samawyCandidates.map((samawyCandidate) => ({
          candidateId: candidate.id,
          rowTitle: candidate.title,
          matchedTitle: samawyCandidate.title,
          externalId: samawyCandidate.externalId,
          confidence: samawyCandidate.confidence,
          reasons: samawyCandidate.reasons.join("; "),
        })),
      ),
    ),
    "DB Candidates",
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(
      candidates
        .filter((candidate) => candidate.classificationDecision?.startsWith("parked") || candidate.classificationDecision?.startsWith("excluded"))
        .map((candidate) => ({
          candidateId: candidate.id,
          title: candidate.title,
          decision: candidate.classificationDecision,
          reason: candidate.decisionReason,
        })),
    ),
    "Exceptions",
  );
  const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  const key = keySegments("reports", "intake", batch.id, "intake-report.xlsx");
  await env.ASSET_BUCKET.put(key, buffer, {
    httpMetadata: { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  });
  await repo.putArtifact(crypto.randomUUID(), {
    batchId,
    artifactType: "intake_report",
    descriptor: {
      key,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sizeBytes: buffer.byteLength,
    },
  });
  await repo.updateBatch(batch.id, { reportObjectKey: key });
  return key;
}

export async function generateAudiobookWorkbookBuffer(repo: Repository, audiobookId: string, result?: ProcessingJobResult): Promise<{ buffer: Uint8Array; filename: string }> {
  const audiobook = await repo.getAudiobook(audiobookId);
  if (!audiobook) throw new Error("Audiobook not found.");
  const tracks = await repo.listTracks(audiobookId);
  const candidate = await repo.getCandidate(audiobook.candidateId);
  const processingRuns = await repo.listProcessingRuns(audiobook.id);
  const latestProcessingRun = processingRuns[0] ?? null;
  const sampleDurationSeconds =
    audiobook.sampleStartSeconds != null && audiobook.sampleEndSeconds != null
      ? Math.max(0, audiobook.sampleEndSeconds - audiobook.sampleStartSeconds)
      : 0;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{
    title: audiobook.title,
    subtitle: audiobook.subtitle,
    author: audiobook.author,
    narrator: audiobook.narrator,
    isbn: audiobook.isbn,
    pubYear: audiobook.pubYear,
    genre: audiobook.genre,
    blurb: audiobook.blurb,
    publisher: audiobook.publisherName,
    classification: audiobook.classificationDecision,
    totalFinalSizeMb: Number((audiobook.totalFinalSizeBytes / (1024 ** 2)).toFixed(2)),
    totalOriginalSizeMb: Number((audiobook.totalOriginalSizeBytes / (1024 ** 2)).toFixed(2)),
    processingStatus: audiobook.processingStatus,
    dossierStatus: audiobook.dossierStatus,
    sampleDurationSeconds,
    clickupSyncStatus: audiobook.clickupSyncStatus,
  }]), "Summary");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{
    ...audiobook.metadataSnapshot,
    recordId: audiobook.id,
    storageBasePath: audiobook.storageBasePath,
    dossierWorkbookKey: audiobook.dossierWorkbookKey,
    dossierAudioZipKey: audiobook.dossierAudioZipKey,
    sampleObjectKey: audiobook.sampleObjectKey,
    coverObjectKey: audiobook.coverObjectKey,
  }]), "Metadata");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(tracks.map((track) => ({
    originalFilename: track.originalFilename,
    originalDetectedTitle: track.originalDetectedTitle,
    originalOrderIndex: track.originalOrderIndex,
    originalSizeMb: Number((track.originalSizeBytes / (1024 ** 2)).toFixed(2)),
    originalDurationSeconds: track.originalDurationSeconds,
    originalBitrateKbps: track.originalBitrateKbps,
    originalSampleRateHz: track.originalSampleRateHz,
    originalChannels: track.originalChannels,
    finalFilename: track.finalFilename,
    finalTitle: track.finalTitle,
    finalOrderIndex: track.finalOrderIndex,
    finalSizeMb: Number(((track.finalSizeBytes ?? 0) / (1024 ** 2)).toFixed(2)),
    finalDurationSeconds: track.finalDurationSeconds,
    finalBitrateKbps: track.finalBitrateKbps,
    finalSampleRateHz: track.finalSampleRateHz,
    finalChannels: track.finalChannels,
    titleProvenance: track.titleProvenance,
    approvalStatus: track.approvalStatus,
    transformationNotes: track.transformationNotes,
  }))), "Technical");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{
    decision: audiobook.classificationDecision,
    candidateId: audiobook.candidateId,
    candidateTitle: candidate?.title ?? null,
    reasons: candidate?.samawyCandidates.map((e) => `${e.title} (${e.confidence})`).join("; ") ?? "",
  }]), "Classification");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{
    totalBookPass: audiobook.totalFinalSizeBytes <= 400 * 1024 * 1024,
    perTrackPass: tracks.every((t) => (t.finalSizeBytes ?? 0) <= 100 * 1024 * 1024),
    selectedSampleTrackId: audiobook.sampleTrackId,
    sampleStartSeconds: audiobook.sampleStartSeconds,
    sampleEndSeconds: audiobook.sampleEndSeconds,
  }]), "Validation");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{
    processingRunId: latestProcessingRun?.id ?? null,
    processingResult: result ? JSON.stringify(result) : (latestProcessingRun?.resultJson ?? null),
    clickupSyncStatus: audiobook.clickupSyncStatus,
    clickupSyncError: audiobook.clickupSyncError,
    clickupTaskUrl: audiobook.clickupTaskUrl,
  }]), "Processing");
  const buffer = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as Uint8Array;
  const safeName = (audiobook.title ?? "metadata").replace(/[^a-z0-9؀-ۿ]/gi, "_").slice(0, 60);
  return { buffer, filename: `${safeName}.xlsx` };
}

export async function buildDossier(env: Env, repo: Repository, audiobookId: string, result: ProcessingJobResult) {
  const audiobook = await repo.getAudiobook(audiobookId);
  if (!audiobook) throw new Error("Audiobook not found.");
  const tracks = await repo.listTracks(audiobookId);
  const candidate = await repo.getCandidate(audiobook.candidateId);
  const processingRuns = await repo.listProcessingRuns(audiobook.id);
  const latestProcessingRun = processingRuns[0] ?? null;
  const workbook = XLSX.utils.book_new();
  const sampleDurationSeconds =
    audiobook.sampleStartSeconds != null && audiobook.sampleEndSeconds != null
      ? Math.max(0, audiobook.sampleEndSeconds - audiobook.sampleStartSeconds)
      : 0;
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet([
      {
        title: audiobook.title,
        publisher: audiobook.publisherName,
        classification: audiobook.classificationDecision,
        totalFinalSizeMb: Number((audiobook.totalFinalSizeBytes / (1024 ** 2)).toFixed(2)),
        totalOriginalSizeMb: Number((audiobook.totalOriginalSizeBytes / (1024 ** 2)).toFixed(2)),
        processingStatus: audiobook.processingStatus,
        dossierStatus: audiobook.dossierStatus,
        sampleDurationSeconds,
        clickupSyncStatus: audiobook.clickupSyncStatus,
      },
    ]),
    "Summary",
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet([
      {
        ...audiobook.metadataSnapshot,
        recordId: audiobook.id,
        storageBasePath: audiobook.storageBasePath,
        dossierWorkbookKey: audiobook.dossierWorkbookKey,
        dossierAudioZipKey: audiobook.dossierAudioZipKey,
        sampleObjectKey: audiobook.sampleObjectKey,
        coverObjectKey: audiobook.coverObjectKey,
      },
    ]),
    "Metadata",
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(
      tracks.map((track) => ({
        originalFilename: track.originalFilename,
        originalDetectedTitle: track.originalDetectedTitle,
        originalOrderIndex: track.originalOrderIndex,
        originalSizeMb: Number((track.originalSizeBytes / (1024 ** 2)).toFixed(2)),
        originalDurationSeconds: track.originalDurationSeconds,
        originalBitrateKbps: track.originalBitrateKbps,
        originalSampleRateHz: track.originalSampleRateHz,
        originalChannels: track.originalChannels,
        finalFilename: track.finalFilename,
        finalTitle: track.finalTitle,
        finalOrderIndex: track.finalOrderIndex,
        finalSizeMb: Number((((track.finalSizeBytes ?? 0)) / (1024 ** 2)).toFixed(2)),
        finalDurationSeconds: track.finalDurationSeconds,
        finalBitrateKbps: track.finalBitrateKbps,
        finalSampleRateHz: track.finalSampleRateHz,
        finalChannels: track.finalChannels,
        titleProvenance: track.titleProvenance,
        approvalStatus: track.approvalStatus,
        transformationNotes: track.transformationNotes,
      })),
    ),
    "Technical",
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet([
      {
        decision: audiobook.classificationDecision,
        candidateId: audiobook.candidateId,
        candidateTitle: candidate?.title ?? null,
        reasons: candidate?.samawyCandidates.map((entry) => `${entry.title} (${entry.confidence})`).join("; ") ?? "",
      },
    ]),
    "Classification",
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet([
      {
        totalBookPass: audiobook.totalFinalSizeBytes <= 400 * 1024 * 1024,
        perTrackPass: tracks.every((track) => (track.finalSizeBytes ?? 0) <= 100 * 1024 * 1024),
        selectedSampleTrackId: audiobook.sampleTrackId,
        sampleStartSeconds: audiobook.sampleStartSeconds,
        sampleEndSeconds: audiobook.sampleEndSeconds,
      },
    ]),
    "Validation",
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet([
      {
        processingRunId: latestProcessingRun?.id ?? null,
        processingResult: latestProcessingRun?.resultJson ?? JSON.stringify(result),
        clickupSyncStatus: audiobook.clickupSyncStatus,
        clickupSyncError: audiobook.clickupSyncError,
        clickupTaskUrl: audiobook.clickupTaskUrl,
      },
    ]),
    "Processing",
  );

  const workbookBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  const basePrefix = audiobook.storageBasePath ?? buildCatalogStorageBasePath({
    publisherId: audiobook.publisherId,
    publisherName: audiobook.publisherName,
    isbn: audiobook.isbn,
    title: audiobook.title,
  });
  const workbookKey = keySegments(basePrefix, "dossier", "metadata.xlsx");
  await env.ASSET_BUCKET.put(workbookKey, workbookBuffer, {
    httpMetadata: { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  });
  await repo.putArtifact(crypto.randomUUID(), {
    audiobookId,
    artifactType: "dossier_workbook",
    descriptor: { key: workbookKey, sizeBytes: workbookBuffer.byteLength },
  });

  await repo.updateAudiobook(audiobook.id, {
    dossierStatus: "ready",
    dossierWorkbookKey: workbookKey,
    dossierAudioZipKey: result.summary.finalAudioZipKey ?? null,
  });
}

export async function syncAudiobookToClickUp(env: Env, repo: Repository, audiobookId: string, options?: { urgent?: boolean; statusName?: string }) {
  const audiobook = await repo.getAudiobook(audiobookId);
  if (!audiobook || !audiobook.dossierWorkbookKey || !audiobook.dossierAudioZipKey) {
    throw new Error("Dossier must be ready before ClickUp sync.");
  }
  const appBaseUrl = env.APP_BASE_URL ?? "https://samawy-ops.com";

  // Load config and token from DB, fall back to defaults/env
  const [storedConfig, dbToken] = await Promise.all([
    repo.getSetting("clickup"),
    repo.getSetting("clickup_token"),
  ]);
  const config = mergeClickUpConfig(storedConfig ? JSON.parse(storedConfig) : null);
  const resolvedEnv = dbToken ? { ...env, CLICKUP_API_TOKEN: dbToken } : env;

  await repo.updateAudiobook(audiobook.id, { clickupSyncStatus: "syncing", clickupSyncError: null });

  const linkExpiry = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days
  const [workbookUrl, audioZipUrl] = await Promise.all([
    signInternalArtifactUrl({
      baseUrl: appBaseUrl,
      path: `/api/files/${audiobook.dossierWorkbookKey}`,
      key: audiobook.dossierWorkbookKey,
      method: "GET",
      secret: env.INTERNAL_API_SECRET,
      expiresAt: linkExpiry,
    }),
    signInternalArtifactUrl({
      baseUrl: appBaseUrl,
      path: `/api/files/${audiobook.dossierAudioZipKey}`,
      key: audiobook.dossierAudioZipKey,
      method: "GET",
      secret: env.INTERNAL_API_SECRET,
      expiresAt: linkExpiry,
    }),
  ]);
  const extra = {
    appLink: buildAppBookUrl(appBaseUrl, audiobook.id),
    workbookUrl,
    audioZipUrl,
    classification: audiobook.classificationDecision,
    coverStatus: audiobook.coverStatus,
  };
  const customFields = buildClickUpCustomFields(audiobook, config, extra);
  const markdownDescription = buildClickUpDescription(config, extra);

  const priority = options?.urgent ? 1 : undefined;
  try {
    const isUpdate = config.updateExistingTask && !!audiobook.clickupTaskId;
    const statusName = options?.statusName || config.statusName || undefined;
    const task = isUpdate
      ? await updateClickUpTask(resolvedEnv, audiobook.clickupTaskId!, { name: audiobook.title, markdownDescription, customFields, priority, statusName })
      : await createClickUpTask(resolvedEnv, config.listId, { name: audiobook.title, markdownDescription, customFields, priority, statusName });

    // Attach cover image if configured and available
    if (config.attachCover && audiobook.coverObjectKey && resolvedEnv.CLICKUP_API_TOKEN) {
      const coverObj = await env.ASSET_BUCKET.get(audiobook.coverObjectKey);
      if (coverObj) {
        const filename = audiobook.coverObjectKey.split("/").pop() ?? "cover.jpg";
        const contentType = coverObj.httpMetadata?.contentType ?? "image/jpeg";
        await attachCoverToClickUpTask(resolvedEnv, task.id, await coverObj.arrayBuffer(), filename, contentType);
      }
    }

    await repo.updateAudiobook(audiobook.id, {
      clickupTaskId: task.id,
      clickupTaskUrl: task.url,
      clickupSyncStatus: "synced",
      clickupSyncError: null,
      clickupSyncedAt: nowIso(),
    });
  } catch (error) {
    await repo.updateAudiobook(audiobook.id, {
      clickupSyncStatus: "failed",
      clickupSyncError: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function packageAudioZip(
  env: Env,
  prefix: string,
  files: Array<{ name: string; bytes: ArrayBuffer }>,
  sample?: { name: string; bytes: ArrayBuffer },
) {
  const zip = new JSZip();
  const uploadFolder = zip.folder("upload");
  for (const file of files) {
    uploadFolder?.file(file.name, file.bytes);
  }
  if (sample) {
    zip.folder("sample")?.file(sample.name, sample.bytes);
  }
  const content = await zip.generateAsync({ type: "uint8array" });
  const zipKey = keySegments(prefix, "final_audio.zip");
  await env.ASSET_BUCKET.put(zipKey, content, { httpMetadata: { contentType: "application/zip" } });
  return zipKey;
}

export async function generateInteractiveSample(env: Env, repo: Repository, audiobookId: string, input: {
  trackId: string;
  startSeconds: number;
  endSeconds: number;
  actor?: string;
}) {
  const audiobook = await repo.getAudiobook(audiobookId);
  if (!audiobook) throw new Error("Audiobook not found.");
  const tracks = await repo.listTracks(audiobookId);
  const track = tracks.find((entry) => entry.id === input.trackId);
  if (!track?.finalObjectKey || !track.finalFilename) {
    throw new Error("Selected track is not available for sample generation.");
  }
  if (input.endSeconds <= input.startSeconds) {
    throw new Error("Sample end time must be after the start time.");
  }
  const requestBaseUrl = env.APP_BASE_URL ?? "https://samawy-ops.com";
  const expiresAt = Date.now() + 60 * 60 * 1000;
  const sampleObjectKey = keySegments(audiobook.storageBasePath, "artifacts", "sample", "sample.mp3");
  const payload: SampleGenerationPayload & { downloadUrl: string } = {
    audiobookId,
    trackId: track.id,
    sourceObjectKey: track.finalObjectKey,
    sourceFilename: track.finalFilename,
    startSeconds: input.startSeconds,
    endSeconds: input.endSeconds,
    sampleUpload: {
      objectKey: sampleObjectKey,
      uploadUrl: await signInternalArtifactUrl({
        baseUrl: requestBaseUrl,
        path: "/api/internal/artifacts",
        key: sampleObjectKey,
        method: "PUT",
        secret: env.INTERNAL_API_SECRET,
        expiresAt,
      }),
    },
    downloadUrl: await signInternalArtifactUrl({
      baseUrl: requestBaseUrl,
      path: "/api/internal/artifacts",
      key: track.finalObjectKey,
      method: "GET",
      secret: env.INTERNAL_API_SECRET,
      expiresAt,
    }),
    accessClientId: env.CF_ACCESS_CLIENT_ID,
    accessClientSecret: env.CF_ACCESS_CLIENT_SECRET,
  };
  const container = getContainer<AudioProcessorContainer>(env.AUDIO_PROCESSOR_CONTAINER, `${audiobookId}-sample`);
  const response = await container.fetch(
    new Request("http://container/generate-sample", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Sample generation failed: ${response.status} ${body}`);
  }
  const result = await response.json() as { sizeBytes?: number; sampleObjectKey: string };
  await repo.updateSampleSelection(audiobookId, {
    trackId: track.id,
    startSeconds: input.startSeconds,
    endSeconds: input.endSeconds,
  });
  await repo.updateAudiobook(audiobookId, {
    sampleTrackId: track.id,
    sampleStartSeconds: input.startSeconds,
    sampleEndSeconds: input.endSeconds,
    sampleObjectKey: result.sampleObjectKey,
    sampleGeneratedAt: nowIso(),
    dossierStatus: "pending",
  });
  await repo.putArtifact(crypto.randomUUID(), {
    audiobookId,
    artifactType: "sample_clip",
    descriptor: {
      key: result.sampleObjectKey,
      contentType: "audio/mpeg",
      sizeBytes: result.sizeBytes,
    },
  });
  await repo.audit("audiobook_record", audiobookId, "sample.generated", input.actor ?? "system", {
    trackId: track.id,
    startSeconds: input.startSeconds,
    endSeconds: input.endSeconds,
  });
  return result;
}

async function maybeDeleteObject(bucket: R2Bucket, key: string | null | undefined) {
  if (key) {
    await bucket.delete(key);
  }
}

export async function cleanupAudiobookStorage(env: Env, repo: Repository, audiobookId: string) {
  const audiobook = await repo.getAudiobook(audiobookId);
  if (!audiobook?.storageBasePath) return;
  try {
    const prefix = keySegments(audiobook.storageBasePath, "artifacts");
    let cursor: string | undefined;
    do {
      const listed = await env.ASSET_BUCKET.list({ prefix, cursor });
      await Promise.all(listed.objects.map((object) => env.ASSET_BUCKET.delete(object.key)));
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);
    await repo.updateAudiobook(audiobookId, {
      storageCleanupStatus: "completed",
      storageCleanupError: null,
    });
    await repo.audit("audiobook_record", audiobookId, "storage.cleanup.completed", "system", {
      prefix,
    });
  } catch (error) {
    await repo.updateAudiobook(audiobookId, {
      storageCleanupStatus: "failed",
      storageCleanupError: error instanceof Error ? error.message : String(error),
    });
    await repo.audit("audiobook_record", audiobookId, "storage.cleanup.failed", "system", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function cleanupBatchStorageIfTerminal(env: Env, repo: Repository, batchId: string) {
  const books = (await repo.listAudiobooks()).filter((book) => book.batchId === batchId);
  if (!books.length) return;
  const allTerminal = books.every((book) => ["ready", "failed"].includes(book.dossierStatus));
  if (!allTerminal) return;
  const prefix = keySegments("ingestions", batchId);
  let cursor: string | undefined;
  do {
    const listed = await env.ASSET_BUCKET.list({ prefix, cursor });
    await Promise.all(listed.objects.map((object) => env.ASSET_BUCKET.delete(object.key)));
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  await repo.audit("ingestion_batch", batchId, "storage.cleanup.completed", "system", { prefix });
}

export async function finalizeAudiobookDossier(env: Env, repo: Repository, audiobookId: string, apiBaseUrl: string) {
  const log = (action: string, detail: Record<string, unknown>) =>
    repo.audit("audiobook_record", audiobookId, action, "dossier_workflow", detail);

  const audiobook = await repo.getAudiobook(audiobookId);
  if (!audiobook) throw new Error("Audiobook not found.");
  if (!audiobook.sampleObjectKey) throw new Error("Generate a sample before finalizing the dossier.");
  const processingRuns = await repo.listProcessingRuns(audiobookId);
  const latestProcessingRun = processingRuns[0];
  if (!latestProcessingRun?.resultJson) throw new Error("Processed tracks are not available.");
  const result = jsonParse<ProcessingJobResult>(latestProcessingRun.resultJson, {
    status: "failed_retryable",
    summary: { totalOriginalSizeBytes: 0, totalFinalSizeBytes: 0 },
    tracks: [],
  });

  const trackCount = result.tracks.filter((t) => t.finalFilename && t.finalObjectKey).length;
  await log("dossier.started", { message: `Starting dossier generation for ${trackCount} tracks + sample.` });

  // Build signed URLs for all files — zip packaging runs in the container to avoid Worker memory limits
  await log("dossier.signing_urls", { message: `Generating signed download URLs for ${trackCount + 1} files…` });
  const expiresAt = Date.now() + 2 * 60 * 60 * 1000;
  const zipFiles: Array<{ folder: string; name: string; downloadUrl: string }> = [];
  for (const track of result.tracks.filter((t) => t.finalFilename && t.finalObjectKey)) {
    zipFiles.push({
      folder: "upload",
      name: track.finalFilename!,
      downloadUrl: await signInternalArtifactUrl({ baseUrl: apiBaseUrl, path: "/api/internal/artifacts", key: track.finalObjectKey!, method: "GET", secret: env.INTERNAL_API_SECRET, expiresAt }),
    });
  }
  zipFiles.push({
    folder: "sample",
    name: "sample.mp3",
    downloadUrl: await signInternalArtifactUrl({ baseUrl: apiBaseUrl, path: "/api/internal/artifacts", key: audiobook.sampleObjectKey, method: "GET", secret: env.INTERNAL_API_SECRET, expiresAt }),
  });
  const zipKey = keySegments(audiobook.storageBasePath, "dossier", "final_audio.zip");
  const multipartStartUrl = await signMultipartUrl({ baseUrl: apiBaseUrl, path: "/api/internal/multipart-start", key: zipKey, method: "POST", secret: env.INTERNAL_API_SECRET, expiresAt });

  await log("dossier.packaging_start", { message: `Sending ${zipFiles.length} files to container for ZIP packaging…` });
  const container = getContainer<AudioProcessorContainer>(env.AUDIO_PROCESSOR_CONTAINER, audiobookId);
  const zipJobId = `dossier-zip-${audiobookId}`;
  const startResp = await container.fetch(new Request("http://container/package-zip", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId: zipJobId, files: zipFiles, multipartStartUrl, accessClientId: env.CF_ACCESS_CLIENT_ID, accessClientSecret: env.CF_ACCESS_CLIENT_SECRET }),
  }));
  if (!startResp.ok) throw new Error(`Container zip job failed to start: ${startResp.status}`);

  type ZipProgress = { phase?: string; filesDownloaded?: number; totalFiles?: number };
  let lastLoggedDownloaded = -1;
  let zipCompleted = false;
  for (let i = 0; i < 450; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const statusResp = await container.fetch(new Request(`http://container/jobs/${zipJobId}`));
    if (!statusResp.ok) continue;
    const job = await statusResp.json() as { status?: string; error?: string | null; progress?: ZipProgress | null };
    if (job.status === "failed") throw new Error(job.error ?? "Container zip packaging failed.");

    const p = job.progress;
    if (p) {
      if (p.phase === "downloading" && p.filesDownloaded !== lastLoggedDownloaded) {
        lastLoggedDownloaded = p.filesDownloaded ?? 0;
        await log("dossier.packaging_progress", {
          message: `Downloading files: ${p.filesDownloaded}/${p.totalFiles}`,
          filesDownloaded: p.filesDownloaded,
          totalFiles: p.totalFiles,
        });
      } else if (p.phase === "compressing" && lastLoggedDownloaded !== -2) {
        lastLoggedDownloaded = -2;
        await log("dossier.packaging_compressing", { message: "Compressing ZIP archive…" });
      } else if (p.phase === "uploading" && lastLoggedDownloaded !== -3) {
        lastLoggedDownloaded = -3;
        await log("dossier.packaging_uploading", { message: "Uploading ZIP to storage…" });
      }
    }

    if (job.status === "completed") { zipCompleted = true; break; }
  }
  if (!zipCompleted) throw new Error("Container zip packaging timed out after 15 minutes.");
  await log("dossier.packaging_done", { message: "ZIP packaging complete." });

  result.summary.finalAudioZipKey = zipKey;

  let retainedCoverKey: string | null = null;
  if (audiobook.coverObjectKey) {
    await log("dossier.cover", { message: "Copying cover image to dossier folder…" });
    const cover = await env.ASSET_BUCKET.get(audiobook.coverObjectKey);
    if (cover) {
      retainedCoverKey = keySegments(audiobook.storageBasePath, "dossier", "cover", audiobook.coverObjectKey.split("/").pop() ?? "cover");
      await env.ASSET_BUCKET.put(retainedCoverKey, await cover.arrayBuffer(), {
        httpMetadata: { contentType: cover.httpMetadata?.contentType ?? "image/jpeg" },
      });
    }
  }

  await log("dossier.building_workbook", { message: "Building Excel workbook…" });
  await buildDossier(env, repo, audiobookId, result);
  await repo.updateAudiobook(audiobookId, {
    dossierStatus: "ready",
    dossierAudioZipKey: zipKey,
    coverObjectKey: retainedCoverKey ?? audiobook.coverObjectKey,
  });
  await log("dossier.completed", { message: "Dossier ready. Running storage cleanup…" });
  await cleanupAudiobookStorage(env, repo, audiobookId);
  await cleanupBatchStorageIfTerminal(env, repo, audiobook.batchId);
  return { dossierAudioZipKey: zipKey, coverObjectKey: retainedCoverKey };
}

export async function recordProcessingResult(repo: Repository, audiobookId: string, result: ProcessingJobResult) {
  const audiobook = await repo.getAudiobook(audiobookId);
  if (!audiobook) throw new Error("Audiobook not found.");
  await repo.applyProcessingTracks(
    audiobookId,
    result.tracks.map((track) => ({
      originalFilename: track.originalFilename,
      originalSizeBytes: track.originalSizeBytes,
      originalDurationSeconds: track.originalDurationSeconds,
      originalBitrateKbps: track.originalBitrateKbps,
      originalSampleRateHz: track.originalSampleRateHz,
      originalChannels: track.originalChannels,
      finalObjectKey: track.finalObjectKey,
      finalFilename: track.finalFilename,
      finalTitle: track.finalTitle,
      finalSizeBytes: track.finalSizeBytes,
      finalDurationSeconds: track.finalDurationSeconds,
      finalBitrateKbps: track.finalBitrateKbps,
      finalSampleRateHz: track.finalSampleRateHz,
      finalChannels: track.finalChannels,
      notes: track.notes,
    })),
  );
  await repo.updateAudiobook(audiobook.id, {
    processingStatus: result.status === "succeeded" ? "succeeded" : "failed",
    totalFinalSizeBytes: result.summary.totalFinalSizeBytes,
    totalOriginalSizeBytes: result.summary.totalOriginalSizeBytes,
    totalLengthSeconds: result.tracks.reduce((sum, track) => sum + (track.finalDurationSeconds ?? track.originalDurationSeconds ?? 0), 0),
    trackCount: result.tracks.length,
    mp3SpecsSummary: {
      finalBitratesKbps: [...new Set(result.tracks.map((track) => track.finalBitrateKbps).filter(Boolean))],
      finalSampleRatesHz: [...new Set(result.tracks.map((track) => track.finalSampleRateHz).filter(Boolean))],
      finalChannels: [...new Set(result.tracks.map((track) => track.finalChannels).filter(Boolean))],
    },
  });
}

async function deleteR2Prefix(bucket: R2Bucket, prefix: string) {
  let cursor: string | undefined;
  do {
    const listed = await bucket.list({ prefix, cursor });
    if (listed.objects.length > 0) {
      await Promise.all(listed.objects.map((obj) => bucket.delete(obj.key)));
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}

export async function revertBatch(env: Env, repo: Repository, batchId: string): Promise<{ revertedFrom: string; revertedTo: string }> {
  const batch = await repo.getBatch(batchId);
  if (!batch) throw new Error("Batch not found.");

  const { status } = batch;

  // records_created → reconciliation_approved: delete all audiobooks + tracks + their R2 artifacts
  if (status === "records_created") {
    const books = await repo.listAudiobooksByBatch(batchId);
    for (const book of books) {
      await maybeDeleteObject(env.ASSET_BUCKET, book.coverObjectKey);
      await maybeDeleteObject(env.ASSET_BUCKET, book.dossierWorkbookKey);
      await maybeDeleteObject(env.ASSET_BUCKET, book.dossierAudioZipKey);
      await maybeDeleteObject(env.ASSET_BUCKET, book.sampleObjectKey);
      if (book.storageBasePath) {
        await deleteR2Prefix(env.ASSET_BUCKET, keySegments(book.storageBasePath, "artifacts"));
      }
      await repo.deleteAudiobookAndTracks(book.id);
    }
    await repo.updateBatch(batchId, { status: "reconciliation_approved" });
    await repo.audit("ingestion_batch", batchId, "batch.reverted", "operator", { from: status, to: "reconciliation_approved", deletedBooks: books.length });
    return { revertedFrom: status, revertedTo: "reconciliation_approved" };
  }

  // reconciliation_approved / reconciliation_in_review → seller_locked: delete candidates
  if (status === "reconciliation_approved" || status === "reconciliation_in_review") {
    await repo.replaceCandidates(batchId, []);
    await repo.updateBatch(batchId, { status: "seller_locked" });
    await repo.audit("ingestion_batch", batchId, "batch.reverted", "operator", { from: status, to: "seller_locked" });
    return { revertedFrom: status, revertedTo: "seller_locked" };
  }

  // seller_locked → metadata_parsed: clear seller
  if (status === "seller_locked") {
    await repo.updateBatch(batchId, { status: "metadata_parsed", sellerId: null, sellerName: null });
    await repo.audit("ingestion_batch", batchId, "batch.reverted", "operator", { from: status, to: "metadata_parsed" });
    return { revertedFrom: status, revertedTo: "metadata_parsed" };
  }

  // metadata_parsed / parsing_metadata → metadata_sheet_pending: clear metadata rows + delete sheet
  if (status === "metadata_parsed" || status === "parsing_metadata") {
    await maybeDeleteObject(env.ASSET_BUCKET, batch.metadataSheetObjectKey);
    const { metadataNormalizationReport: _, metadataRows: __, ...restNormalization } = batch.normalization as { metadataNormalizationReport?: unknown; metadataRows?: unknown; [key: string]: unknown };
    await repo.updateBatch(batchId, {
      status: "metadata_sheet_pending",
      metadataSheetObjectKey: null,
      normalization: restNormalization,
    });
    await repo.audit("ingestion_batch", batchId, "batch.reverted", "operator", { from: status, to: "metadata_sheet_pending" });
    return { revertedFrom: status, revertedTo: "metadata_sheet_pending" };
  }

  // metadata_sheet_selected → metadata_sheet_pending: clear sheet selection + delete R2 file
  if (status === "metadata_sheet_selected") {
    await maybeDeleteObject(env.ASSET_BUCKET, batch.metadataSheetObjectKey);
    await repo.updateBatch(batchId, { status: "metadata_sheet_pending", metadataSheetObjectKey: null });
    await repo.audit("ingestion_batch", batchId, "batch.reverted", "operator", { from: status, to: "metadata_sheet_pending" });
    return { revertedFrom: status, revertedTo: "metadata_sheet_pending" };
  }

  // normalized / intake_failed → ingested: delete all source + working R2 files, clear manifest + groups
  if (status === "normalized" || status === "intake_failed") {
    await deleteR2Prefix(env.ASSET_BUCKET, keySegments("ingestions", batchId, "source"));
    await deleteR2Prefix(env.ASSET_BUCKET, keySegments("ingestions", batchId, "working"));
    const { groups: _, ...restNormalization } = batch.normalization as { groups?: unknown; [key: string]: unknown };
    await repo.updateBatch(batchId, {
      status: "ingested",
      sourceManifest: [],
      normalization: restNormalization,
    });
    await repo.audit("ingestion_batch", batchId, "batch.reverted", "operator", { from: status, to: "ingested" });
    return { revertedFrom: status, revertedTo: "ingested" };
  }

  throw new Error(`No revert defined for batch status "${status}".`);
}

export async function revertBook(env: Env, repo: Repository, audiobookId: string): Promise<{ revertedFrom: string; revertedTo: string }> {
  const book = await repo.getAudiobook(audiobookId);
  if (!book) throw new Error("Audiobook not found.");

  // Revert dossier (ready/failed → pending): delete workbook + zip
  if (book.dossierStatus === "ready" || book.dossierStatus === "failed" || book.dossierStatus === "generating") {
    await maybeDeleteObject(env.ASSET_BUCKET, book.dossierWorkbookKey);
    await maybeDeleteObject(env.ASSET_BUCKET, book.dossierAudioZipKey);
    await repo.updateAudiobook(audiobookId, {
      dossierStatus: "pending",
      dossierWorkbookKey: null,
      dossierAudioZipKey: null,
      sampleObjectKey: null,
      sampleTrackId: null,
      sampleStartSeconds: null,
      sampleEndSeconds: null,
      sampleGeneratedAt: null,
    });
    await repo.audit("audiobook_record", audiobookId, "book.reverted", "operator", { from: `dossier:${book.dossierStatus}`, to: "dossier:pending" });
    return { revertedFrom: `dossier:${book.dossierStatus}`, revertedTo: "dossier:pending" };
  }

  // Revert processing (succeeded/failed → pending): delete final track R2 files, reset tracks
  if (book.processingStatus === "succeeded" || book.processingStatus === "failed" || book.processingStatus === "running") {
    const tracks = await repo.listTracks(audiobookId);
    for (const track of tracks) {
      await maybeDeleteObject(env.ASSET_BUCKET, track.finalObjectKey);
    }
    // Reset tracks to original-only state
    const resetTracks = tracks.map((track) => ({
      ...track,
      finalObjectKey: null,
      finalFilename: null,
      finalTitle: null,
      finalOrderIndex: track.originalOrderIndex,
      finalSizeBytes: null,
      finalDurationSeconds: null,
      finalBitrateKbps: null,
      finalSampleRateHz: null,
      finalChannels: null,
      approvalStatus: "pending" as const,
    }));
    await repo.replaceTracks(audiobookId, resetTracks);
    await repo.updateAudiobook(audiobookId, { processingStatus: "pending", totalFinalSizeBytes: 0 });
    await repo.audit("audiobook_record", audiobookId, "book.reverted", "operator", { from: `processing:${book.processingStatus}`, to: "processing:pending" });
    return { revertedFrom: `processing:${book.processingStatus}`, revertedTo: "processing:pending" };
  }

  // Revert track preparation (tracks exist → delete them, reset to unprepped)
  const tracks = await repo.listTracks(audiobookId);
  if (tracks.length > 0) {
    await repo.replaceTracks(audiobookId, []);
    await repo.updateAudiobook(audiobookId, { processingStatus: "pending" });
    await repo.audit("audiobook_record", audiobookId, "book.reverted", "operator", { from: "tracks:prepared", to: "tracks:none" });
    return { revertedFrom: "tracks:prepared", revertedTo: "tracks:none" };
  }

  throw new Error(`No revert step available for this audiobook's current state.`);
}

// Allows operators to override the column→field mapping and re-derive metadataRows.
// newMapping: { fieldName: columnIndex | null }
export async function remapBatchMetadata(
  _env: Env,
  repo: Repository,
  batchId: string,
  newMapping: Record<string, number | null>,
): Promise<void> {
  const batch = await repo.getBatch(batchId);
  if (!batch) throw new Error("Batch not found.");

  const rawRows = (batch.normalization as { rawWorkbookRows?: RawWorkbookRow[] }).rawWorkbookRows;
  if (!rawRows || rawRows.length === 0) {
    throw new Error("Raw workbook rows not available. Re-parse the metadata sheet first.");
  }

  const existingReport = batch.normalization.metadataNormalizationReport as (import("./types").MetadataNormalizationReport & { headerCells?: unknown }) | undefined;
  const headerRowNumber = existingReport?.headerRowNumber ?? null;

  // Rebuild columns from the new mapping, preserving header text from the existing headerCells.
  const headerCells = extractHeaderCells(rawRows, headerRowNumber);
  const columns = Object.fromEntries(
    METADATA_FIELDS.map((field) => {
      const idx = newMapping[field] ?? null;
      const cell = idx != null ? headerCells.find((c) => c.index === idx) : null;
      return [field, { index: idx, header: cell?.header ?? null, confidence: idx != null ? 0.95 : null }];
    }),
  ) as HeaderDetectionResult["columns"];

  const detection: HeaderDetectionResult = { strategy: "heuristic", headerRowNumber, columns, warnings: [] };
  const normalized = fallbackNormalizeRows(rawRows, detection);
  const updatedReport = {
    ...(existingReport ?? {}),
    mode: "heuristic" as const,
    headerRowNumber,
    columns,
    headerCells,
    rowReports: normalized.report.rowReports,
    warnings: [],
  };

  await repo.updateBatch(batchId, {
    normalization: {
      ...batch.normalization,
      metadataRows: normalized.rows,
      metadataNormalizationReport: updatedReport,
    },
  });
  await repo.audit("ingestion_batch", batchId, "metadata.remap.completed", "operator", {
    fieldCount: Object.keys(newMapping).filter((k) => newMapping[k] != null).length,
  });
}

import type { SourceManifestItem } from "./types";

export function nowIso(): string {
  return new Date().toISOString();
}

/** Extract a Google Drive folder ID from either a raw ID or a full URL */
export function extractDriveFolderId(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  // If it's already just an ID (no slashes), return as-is
  if (!trimmed.includes('/')) return trimmed;
  // Extract ID from URL patterns like:
  // https://drive.google.com/drive/folders/1EaZsrkMkj4f25WstyOEqyc4iNcX1ugQB
  // https://drive.google.com/drive/u/0/folders/1EaZsrkMkj4f25WstyOEqyc4iNcX1ugQB
  const match = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  return match?.[1] ?? trimmed;
}

export function jsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function sanitizeStorageSegment(input: string, fallback = "unknown"): string {
  const normalized = slugify((input || "").replace(/\s+/g, " ").trim());
  return normalized || fallback;
}

export function formatStorageSize(bytes: number | null | undefined): string {
  const value = typeof bytes === "number" && Number.isFinite(bytes) ? bytes : 0;
  const gb = value / (1024 ** 3);
  if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 1 : 2)} GB`;
  const mb = value / (1024 ** 2);
  return `${Math.max(mb, 0.01).toFixed(mb >= 10 ? 1 : 2)} MB`;
}

export function buildPublisherStorageSegment(publisherId: number, publisherName: string): string {
  return `${publisherId}_${sanitizeStorageSegment(publisherName, `publisher-${publisherId}`)}`;
}

export function buildBookStorageSegment(isbn: string | null | undefined, title: string): string {
  if (isbn && isbn.trim()) {
    return `${sanitizeStorageSegment(isbn, "isbn")}_${sanitizeStorageSegment(title, "untitled-book")}`;
  }
  return `no-isbn_${sanitizeStorageSegment(title, "untitled-book")}`;
}

export function buildCatalogStorageBasePath(input: {
  publisherId: number;
  publisherName: string;
  isbn?: string | null;
  title: string;
}): string {
  return keySegments(
    buildPublisherStorageSegment(input.publisherId, input.publisherName),
    buildBookStorageSegment(input.isbn, input.title),
  );
}

export function buildAppBookUrl(baseUrl: string, audiobookId: string): string {
  return new URL(`/books/${audiobookId}`, ensureTrailingSlash(baseUrl)).toString();
}

export function ensureTrailingSlash(input: string): string {
  return input.endsWith("/") ? input : `${input}/`;
}

export function keySegments(...parts: Array<string | number | undefined | null>): string {
  return parts
    .filter((part) => part !== undefined && part !== null && `${part}`.length > 0)
    .map((part) => `${part}`.replace(/^\/+|\/+$/g, ""))
    .join("/");
}

export function inferIntakeMode(items: SourceManifestItem[]) {
  const zipCount = items.filter((item) => item.name.toLowerCase().endsWith(".zip")).length;
  const folderDepths = new Set(items.map((item) => item.parentPath.split("/").filter(Boolean).length));
  const audioItems = items.filter((item) => /\.(mp3|m4a|m4b|wav|flac|aac|ogg)$/i.test(item.name));
  const audioCount = audioItems.length;
  const maxAudioDepth = audioCount > 0 ? Math.max(...audioItems.map((item) => item.parentPath.split("/").filter(Boolean).length)) : 0;

  if (zipCount === 1 && folderDepths.size <= 1) return "single_book_zip" as const;
  if (zipCount > 1 && folderDepths.size <= 1) return "multi_book_zip_batch" as const;
  if (zipCount > 0 && [...folderDepths].some((depth) => depth >= 1)) return "book_subfolders_with_zip" as const;
  if (audioCount > 0 && maxAudioDepth >= 2) return "book_subfolders_subfolders_with_tracks" as const;
  if (audioCount > 0 && maxAudioDepth >= 1) return "book_subfolders_with_tracks" as const;
  if (audioCount > 0 && folderDepths.size <= 1) return "flat_tracks_single_book" as const;
  return items.length > 0 ? "mixed_delivery_batch" as const : "ambiguous_source" as const;
}

export function naturalSort<T>(items: T[], getValue: (item: T) => string): T[] {
  return [...items].sort((a, b) =>
    getValue(a).localeCompare(getValue(b), undefined, { numeric: true, sensitivity: "base" }),
  );
}

export function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9\u0600-\u06ff]+/g, " ")
      .split(/\s+/)
      .filter(Boolean);
  const left = normalize(a);
  const right = new Set(normalize(b));
  if (!left.length || !right.size) return 0;
  const overlap = left.filter((token) => right.has(token)).length;
  return overlap / Math.max(left.length, right.size);
}

function toBase64Url(bytes: Uint8Array): string {
  const binary = String.fromCharCode.apply(null, bytes as unknown as number[]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return toBase64Url(new Uint8Array(signature));
}

// ─── Dossier links for ClickUp ────────────────────────────────────────────────
// A stable, permanent per-book link that signs only the book id + kind (not the
// file path). It never expires, survives the dossier being regenerated under a
// new R2 key, and avoids the path-encoding fragility of signing Arabic/slash
// object keys. The handler resolves the current dossier key at click time.
export async function signDossierToken(secret: string, bookId: string, kind: 'workbook' | 'audio'): Promise<string> {
  return hmac(secret, `dossier:${bookId}:${kind}`);
}

export async function verifyDossierToken(secret: string, bookId: string, kind: string, token: string): Promise<boolean> {
  if (kind !== 'workbook' && kind !== 'audio') return false;
  const expected = await hmac(secret, `dossier:${bookId}:${kind}`);
  return expected === token;
}

export function buildDossierLink(baseUrl: string, bookId: string, kind: 'workbook' | 'audio', token: string): string {
  const url = new URL(`/api/books/${bookId}/dossier/${kind}`, baseUrl);
  url.searchParams.set('t', token);
  return url.toString();
}

function stableQuery(params: Record<string, string>): string {
  return Object.entries(params)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

export async function signInternalArtifactUrl(input: {
  baseUrl: string;
  path: string;
  key: string;
  method: "GET" | "PUT";
  secret: string;
  expiresAt?: number; // omit for permanent links (e.g. ClickUp dossier URLs)
}): Promise<string> {
  const url = new URL(input.path, input.baseUrl);
  const query: Record<string, string> = {
    key: input.key,
    method: input.method,
  };
  if (input.expiresAt != null) {
    query.expires = String(input.expiresAt);
  }
  const signature = await hmac(input.secret, `${url.pathname}?${stableQuery(query)}`);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("sig", signature);
  return url.toString();
}

/** Build a signed, email-safe absolute URL for a studio's uploaded logo (served
 *  via /api/files), or undefined when the studio has no logo. Valid for 7 days. */
export async function signedStudioLogoUrl(
  env: { INTERNAL_API_SECRET: string },
  baseUrl: string,
  logoObjectKey: string | null | undefined,
): Promise<string | undefined> {
  if (!logoObjectKey) return undefined;
  return signInternalArtifactUrl({
    baseUrl,
    path: `/api/files/${logoObjectKey}`,
    key: logoObjectKey,
    method: "GET",
    secret: env.INTERNAL_API_SECRET,
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
  });
}

export async function signMultipartUrl(input: {
  baseUrl: string;
  path: string;
  key: string;
  uploadId?: string;
  part?: number;
  method: string;
  secret: string;
  expiresAt: number;
}): Promise<string> {
  const url = new URL(input.path, input.baseUrl);
  const query: Record<string, string> = {
    expires: String(input.expiresAt),
    key: input.key,
    method: input.method,
  };
  if (input.uploadId) query.uploadId = input.uploadId;
  if (input.part != null) query.part = String(input.part);
  const signature = await hmac(input.secret, `${url.pathname}?${stableQuery(query)}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  url.searchParams.set("sig", signature);
  return url.toString();
}

export async function verifyMultipartRequest(input: {
  url: URL;
  secret: string;
  method: string;
}): Promise<{ ok: boolean; key?: string; uploadId?: string; part?: number; reason?: string }> {
  const key = input.url.searchParams.get("key");
  const expires = input.url.searchParams.get("expires");
  const method = input.url.searchParams.get("method");
  const signature = input.url.searchParams.get("sig");
  const uploadId = input.url.searchParams.get("uploadId") ?? undefined;
  const partStr = input.url.searchParams.get("part");

  if (!key || !expires || !method || !signature) return { ok: false, reason: "missing_params" };
  if (input.method.toUpperCase() !== method.toUpperCase()) return { ok: false, reason: "method_mismatch" };
  const expiresAt = Number(expires);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return { ok: false, reason: "expired" };

  const query: Record<string, string> = { expires, key, method };
  if (uploadId) query.uploadId = uploadId;
  if (partStr) query.part = partStr;

  const expected = await hmac(input.secret, `${input.url.pathname}?${stableQuery(query)}`);
  if (expected !== signature) return { ok: false, reason: "bad_signature" };
  return { ok: true, key, uploadId, part: partStr ? Number(partStr) : undefined };
}

export async function verifyInternalArtifactRequest(input: {
  url: URL;
  secret: string;
  method: string;
}): Promise<{ ok: boolean; key?: string; reason?: string }> {
  const key = input.url.searchParams.get("key");
  const expires = input.url.searchParams.get("expires"); // null = permanent link (no expiry)
  const method = input.url.searchParams.get("method");
  const signature = input.url.searchParams.get("sig");

  if (!key || !method || !signature) {
    return { ok: false, reason: "missing_signature_params" };
  }
  if (input.method.toUpperCase() !== method.toUpperCase()) {
    return { ok: false, reason: "method_mismatch" };
  }
  // Only check expiry when the link was signed with one
  if (expires !== null) {
    const expiresAt = Number(expires);
    if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
      return { ok: false, reason: "expired" };
    }
  }
  const query: Record<string, string> = { key, method };
  if (expires !== null) query.expires = expires;
  const expected = await hmac(input.secret, `${input.url.pathname}?${stableQuery(query)}`);
  if (expected !== signature) {
    return { ok: false, reason: "bad_signature" };
  }
  return { ok: true, key };
}

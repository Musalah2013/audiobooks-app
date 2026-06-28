import { AwsClient } from "aws4fetch";
import * as XLSX from "xlsx";
import type { Env, MetadataRow, SamawyBookCandidate, SamawySeller, SourceManifestItem } from "./types";
import { similarity, toNumber } from "./utils";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableDriveStatus(status: number) {
  return [408, 425, 429, 500, 502, 503, 504].includes(status);
}

function isGoogleNativeMimeType(mimeType: string) {
  return mimeType.startsWith("application/vnd.google-apps.");
}

async function fetchDriveApiWithRetry(
  input: RequestInfo | URL,
  init: RequestInit,
  attempts = 4,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(new Error("drive_api_timeout")), 30_000);
    try {
      const response = await fetch(input, {
        ...init,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!response.ok && isRetryableDriveStatus(response.status) && attempt < attempts) {
        await sleep(Math.min(8_000, attempt * 1_500));
        continue;
      }
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      lastError = error;
      if (attempt >= attempts) break;
      await sleep(Math.min(8_000, attempt * 1_500));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function extractDriveId(input: string): string {
  // Match the folder ID segment from Drive URLs: /folders/<ID> or /drive/folders/<ID>
  const folderMatch = input.match(/\/folders\/([a-zA-Z0-9_-]{10,})/);
  if (folderMatch) return folderMatch[1];
  const queryId = (() => {
    try {
      const url = new URL(input);
      return url.searchParams.get("id");
    } catch {
      return null;
    }
  })();
  if (queryId && /^[a-zA-Z0-9_-]{10,}$/.test(queryId)) return queryId;
  // Fallback: first long alphanumeric segment
  const fallback = input.match(/[a-zA-Z0-9_-]{25,}/);
  if (!fallback) throw new Error("Unable to extract a Google Drive folder ID from the provided link.");
  return fallback[0];
}

async function assertDriveFolderAccessible(
  env: Env,
  folderId: string,
  token: string,
): Promise<void> {
  const params = new URLSearchParams({
    fields: "id,name,mimeType",
    supportsAllDrives: "true",
  });
  const resp = await fetchDriveApiWithRetry(`${env.GOOGLE_DRIVE_API_BASE_URL}/files/${folderId}?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (resp.ok) return;

  if (resp.status === 404) {
    throw new Error(
      "Google Drive folder is not accessible to the configured service account. " +
      "Share the folder with vm-audiobooks-service-account@samawy.iam.gserviceaccount.com and retry.",
    );
  }

  const body = await resp.text().catch(() => "");
  throw new Error(`Failed to access Drive folder ${folderId}: ${resp.status}${body ? ` ${body}` : ""}`);
}

function toBase64Url(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export async function getServiceAccountToken(env: Env): Promise<string> {
  if (!env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
    throw new Error(
      "Google Drive service account credentials are not configured. " +
      "Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY as worker secrets.",
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const header = toBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = toBase64Url(JSON.stringify({
    iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    scope: "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  }));

  const signingInput = `${header}.${payload}`;

  const pem = env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, "\n");
  const pemBody = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const keyBytes = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyBytes,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signingInput),
  );

  const jwt = `${signingInput}.${toBase64Url(new Uint8Array(signature))}`;

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Service account token exchange failed: ${resp.status} ${body}`);
  }

  const data = (await resp.json()) as { access_token: string };
  return data.access_token;
}

function isMacJunk(name: string): boolean {
  // Skip macOS AppleDouble resource fork files and other junk
  return name.startsWith("._") || name === ".DS_Store" || name.startsWith("__MACOSX");
}

export async function listDriveFiles(
  env: Env,
  driveLink: string,
  token: string,
  recursive = true,
  onProgress?: (state: { filesFound: number; foldersVisited: number; currentFolder: string }) => Promise<void>,
): Promise<SourceManifestItem[]> {
  const folderId = extractDriveId(driveLink);
  await assertDriveFolderAccessible(env, folderId, token);
  const results: SourceManifestItem[] = [];
  const visitedFolders = new Set<string>();
  const visitedFiles = new Set<string>();
  let traversedEntries = 0;

  // Safety caps so a pathologically large or cyclic Drive structure can't make
  // listing run unbounded (and exhaust the Worker before copying even starts).
  const MAX_FILES = 25_000;
  const MAX_FOLDERS = 8_000;

  async function listFolder(folderId: string, parentPath: string) {
    if (visitedFolders.has(folderId)) return;
    if (visitedFolders.size >= MAX_FOLDERS) {
      throw new Error(`Drive folder traversal exceeded ${MAX_FOLDERS} folders; refusing to continue. Split the source into smaller folders.`);
    }
    visitedFolders.add(folderId);
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        q: `'${folderId}' in parents and trashed = false`,
        fields: "nextPageToken,files(id,name,mimeType,size,shortcutDetails(targetId,targetMimeType))",
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true",
        pageSize: "1000",
      });
      if (pageToken) params.set("pageToken", pageToken);

      const resp = await fetchDriveApiWithRetry(`${env.GOOGLE_DRIVE_API_BASE_URL}/files?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!resp.ok) throw new Error(`Failed to list Drive folder ${folderId}: ${resp.status}`);

      const payload = (await resp.json()) as {
        nextPageToken?: string;
        files: Array<{
          id: string;
          name: string;
          mimeType: string;
          size?: string;
          shortcutDetails?: {
            targetId?: string;
            targetMimeType?: string;
          };
        }>;
      };

      for (const file of payload.files) {
        traversedEntries += 1;
        if (results.length >= MAX_FILES) {
          throw new Error(`Drive folder contains more than ${MAX_FILES} downloadable files; refusing to continue. Split the source into smaller folders.`);
        }
        if (isMacJunk(file.name)) continue;
        if (file.mimeType === "application/vnd.google-apps.folder") {
          if (recursive) {
            const subPath = parentPath ? `${parentPath}/${file.name}` : file.name;
            await listFolder(file.id, subPath);
          }
        } else if (file.mimeType === "application/vnd.google-apps.shortcut") {
          const targetId = file.shortcutDetails?.targetId;
          const targetMimeType = file.shortcutDetails?.targetMimeType;
          if (!targetId || !targetMimeType) continue;
          if (targetMimeType === "application/vnd.google-apps.folder") {
            if (recursive) {
              const subPath = parentPath ? `${parentPath}/${file.name}` : file.name;
              await listFolder(targetId, subPath);
            }
          } else if (!visitedFiles.has(targetId)) {
            visitedFiles.add(targetId);
            results.push({
              key: targetId,
              name: file.name,
              mimeType: targetMimeType,
              sizeBytes: toNumber(file.size),
              parentPath,
            });
          }
        } else if (!isGoogleNativeMimeType(file.mimeType)) {
          if (visitedFiles.has(file.id)) continue;
          visitedFiles.add(file.id);
          results.push({
            key: file.id,
            name: file.name,
            mimeType: file.mimeType,
            sizeBytes: toNumber(file.size),
            parentPath,
          });
        }
      }

      pageToken = payload.nextPageToken;
      if (onProgress) {
        await onProgress({
          filesFound: results.length,
          foldersVisited: visitedFolders.size,
          currentFolder: parentPath || "(root)",
        });
      }
    } while (pageToken);
  }

  await listFolder(folderId, "");
  if (results.length === 0) {
    throw new Error(
      traversedEntries === 0
        ? "Google Drive folder is accessible but empty."
        : "Google Drive folder was traversed, but no downloadable source files were found. Check whether the folder contains only unsupported Google-native files, inaccessible shortcuts, or empty subfolders.",
    );
  }
  return results;
}

export async function searchSamawySellers(env: Env, query: string): Promise<SamawySeller[]> {
  if (!env.SAMAWY_DB_PROXY_BASE_URL) {
    return [
      { id: 101, name: "العبيكان" },
      { id: 102, name: "دار الشروق" },
    ].filter((seller) => seller.name.includes(query) || String(seller.id).includes(query));
  }

  const response = await fetch(
    `${env.SAMAWY_DB_PROXY_BASE_URL}/publishers?search=${encodeURIComponent(query)}&limit=50&offset=0`,
    {
      headers: {
        "CF-Access-Client-Id": env.SAMAWY_DB_PROXY_CLIENT_ID ?? "",
        "CF-Access-Client-Secret": env.SAMAWY_DB_PROXY_CLIENT_SECRET ?? "",
      },
    },
  );
  if (!response.ok) throw new Error(`Seller search failed: ${response.status}`);
  const rows = (await response.json()) as Array<{ id: number; name: string; email?: string | null; active?: boolean | null }>;
  return rows
    .filter((row) => row.active !== false)
    .map((row) => ({ id: row.id, name: row.name }));
}

/**
 * Genres from the Samawy DB proxy for the metadata dropdowns. The proxy follows
 * the same REST shape as /publishers and /booksets, so we probe the conventional
 * paths and parse flexibly (array of strings, or rows with name/title/genre).
 * Returns a deduped, sorted list; empty when the proxy is unconfigured/unreachable.
 */
export async function fetchSamawyGenres(env: Env): Promise<Array<{ id: number | string | null; name: string }>> {
  if (!env.SAMAWY_DB_PROXY_BASE_URL) return [];
  const headers = {
    "CF-Access-Client-Id": env.SAMAWY_DB_PROXY_CLIENT_ID ?? "",
    "CF-Access-Client-Secret": env.SAMAWY_DB_PROXY_CLIENT_SECRET ?? "",
  };
  const res = await fetch(`${env.SAMAWY_DB_PROXY_BASE_URL}/categories?limit=1000&offset=0`, { headers });
  if (!res.ok) throw new Error(`Genres (categories) fetch failed: ${res.status}`);
  const data = (await res.json()) as unknown;
  const rows: unknown[] = Array.isArray(data)
    ? data
    : ((data as Record<string, unknown>)?.categories as unknown[])
      ?? ((data as Record<string, unknown>)?.genres as unknown[])
      ?? ((data as Record<string, unknown>)?.results as unknown[])
      ?? ((data as Record<string, unknown>)?.data as unknown[])
      ?? [];
  const seen = new Set<string>();
  return rows
    .map((r) => {
      if (typeof r === "string") return { id: null as number | string | null, name: r };
      const o = r as Record<string, unknown>;
      const name = (o.name ?? o.title ?? o.category ?? o.genre ?? o.label ?? o.value) as string | undefined;
      return name ? { id: (o.id as number | string | null) ?? null, name: String(name) } : null;
    })
    .filter((g): g is { id: number | string | null; name: string } => !!g && g.name.trim().length > 0)
    .filter((g) => { const k = g.name.trim().toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function lookupSamawyCandidates(
  env: Env,
  sellerId: number,
  metadata: MetadataRow,
): Promise<SamawyBookCandidate[]> {
  if (!env.SAMAWY_DB_PROXY_BASE_URL) {
    if (!metadata.title) return [];
    return [
      {
        externalId: `${sellerId}:${metadata.title}`,
        title: metadata.title,
        subtitle: metadata.subtitle,
        author: metadata.author,
        isbn: metadata.isbn,
        confidence: metadata.isbn ? 0.9 : 0.62,
        reasons: metadata.isbn ? ["stub ISBN match"] : ["stub title/author match"],
      },
    ];
  }

  const response = await fetch(
    `${env.SAMAWY_DB_PROXY_BASE_URL}/booksets/eligible-pool?seller_id=${sellerId}&limit=200&offset=0`,
    {
      headers: {
        "CF-Access-Client-Id": env.SAMAWY_DB_PROXY_CLIENT_ID ?? "",
        "CF-Access-Client-Secret": env.SAMAWY_DB_PROXY_CLIENT_SECRET ?? "",
      },
    },
  );
  if (!response.ok) throw new Error(`Samawy candidate lookup failed: ${response.status}`);
  const rows = (await response.json()) as Array<{
    id: number;
    sellerId: number;
    bookId: number | null;
    isbn: string | null;
    title: string | null;
    sellingPrice: number | null;
    publishYear: number | null;
  }>;

  const candidates: SamawyBookCandidate[] = [];
  for (const row of rows) {
    if (!row.title) continue;
    const reasons: string[] = [];
    let confidence = 0.5;

    if (metadata.isbn && row.isbn && metadata.isbn === row.isbn) {
      confidence = 0.95;
      reasons.push("ISBN exact match");
    }
    if (metadata.title && row.title) {
      const titleSim = similarity(metadata.title, row.title);
      if (titleSim > 0.8) {
        confidence = Math.max(confidence, 0.85);
        reasons.push("Title strong match");
      } else if (titleSim > 0.5) {
        confidence = Math.max(confidence, 0.65);
        reasons.push("Title partial match");
      }
    }
    if (metadata.author && row.title) {
      const authorSim = similarity(metadata.author, row.title);
      if (authorSim > 0.6) {
        confidence = Math.max(confidence, 0.7);
        reasons.push("Author match");
      }
    }

    if (reasons.length > 0) {
      candidates.push({
        externalId: `${row.sellerId}:${row.id}`,
        title: row.title,
        isbn: row.isbn ?? undefined,
        publishYear: row.publishYear ? String(row.publishYear) : undefined,
        confidence,
        reasons,
      });
    }
  }

  return candidates.sort((a, b) => b.confidence - a.confidence);
}

export async function createClickUpTask(
  env: Env,
  listId: string,
  input: {
    name: string;
    markdownDescription: string;
    customFields: Array<{ id: string; value: unknown }>;
    priority?: number;
    statusName?: string;
  },
): Promise<{ id: string; url: string }> {
  if (!env.CLICKUP_API_TOKEN) {
    return {
      id: crypto.randomUUID(),
      url: `https://app.clickup.com/t/stub-${crypto.randomUUID()}`,
    };
  }
  const body: Record<string, unknown> = {
    name: input.name,
    markdown_description: input.markdownDescription,
    custom_fields: input.customFields,
  };
  if (input.priority != null) body.priority = input.priority;
  if (input.statusName) body.status = input.statusName;
  const response = await fetch(`${env.CLICKUP_API_BASE_URL}/list/${listId}/task`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: env.CLICKUP_API_TOKEN },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`ClickUp task creation failed: ${response.status}`);
  const payload = (await response.json()) as { id: string; url: string };
  return { id: payload.id, url: payload.url };
}

export async function updateClickUpTask(
  env: Env,
  taskId: string,
  input: {
    name: string;
    markdownDescription: string;
    customFields: Array<{ id: string; value: unknown }>;
    priority?: number;
    statusName?: string;
  },
): Promise<{ id: string; url: string }> {
  if (!env.CLICKUP_API_TOKEN) {
    return { id: taskId, url: `https://app.clickup.com/t/${taskId}` };
  }
  // Update task name, description, optional priority, and optional status
  const updateBody: Record<string, unknown> = { name: input.name, markdown_description: input.markdownDescription };
  if (input.priority != null) updateBody.priority = input.priority;
  if (input.statusName) updateBody.status = input.statusName;
  const taskResp = await fetch(`${env.CLICKUP_API_BASE_URL}/task/${taskId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: env.CLICKUP_API_TOKEN },
    body: JSON.stringify(updateBody),
  });
  if (!taskResp.ok) throw new Error(`ClickUp task update failed: ${taskResp.status}`);
  const task = (await taskResp.json()) as { id: string; url: string };
  // Update custom fields one at a time (ClickUp requires individual PATCH per field)
  await Promise.allSettled(
    input.customFields.map((field) =>
      fetch(`${env.CLICKUP_API_BASE_URL}/task/${taskId}/field/${field.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: env.CLICKUP_API_TOKEN! },
        body: JSON.stringify({ value: field.value }),
      }),
    ),
  );
  return { id: task.id, url: task.url ?? `https://app.clickup.com/t/${taskId}` };
}

export async function attachCoverToClickUpTask(
  env: Env,
  taskId: string,
  coverData: ArrayBuffer,
  filename: string,
  contentType: string,
): Promise<void> {
  if (!env.CLICKUP_API_TOKEN) return;
  const form = new FormData();
  form.append("attachment", new Blob([coverData], { type: contentType }), filename);
  await fetch(`${env.CLICKUP_API_BASE_URL}/task/${taskId}/attachment`, {
    method: "POST",
    headers: { Authorization: env.CLICKUP_API_TOKEN },
    body: form,
  });
}

export function createR2Signer(env: Env) {
  if (!env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_ACCOUNT_ID) return null;
  return new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  });
}

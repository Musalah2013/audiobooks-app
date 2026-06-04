import { Hono } from 'hono';
import type { Env } from '../types';

const files = new Hono<{ Bindings: Env }>();

files.get('/*', async (c) => {
  const key = decodeURIComponent(c.req.path.replace("/api/files/", ""));
  const filename = key.split("/").pop() ?? "download";

  // Serve a download landing page for browser navigations so the user sees
  // feedback instead of a blank tab. Programmatic callers (curl, containers)
  // don't send text/html in Accept and skip straight to the file.
  const accept = c.req.header("accept") ?? "";
  const isDirect = c.req.query("_dl") === "1";
  if (!isDirect && accept.includes("text/html")) {
    const directUrl = new URL(c.req.url);
    directUrl.searchParams.set("_dl", "1");
    const escapedFilename = filename.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const escapedUrl = directUrl.toString().replace(/"/g, "&quot;");
    return new Response(
      `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Downloading ${escapedFilename}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f0f4f8;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.08);padding:2.5rem 3rem;max-width:480px;width:90%;text-align:center}
.icon{font-size:3rem;margin-bottom:1rem}
h1{font-size:1.4rem;font-weight:600;color:#1a202c;margin-bottom:.5rem}
p{color:#718096;font-size:.95rem;line-height:1.6;margin-bottom:1.5rem}
.filename{font-family:monospace;background:#edf2f7;padding:.25rem .6rem;border-radius:6px;font-size:.85rem;color:#2d3748;word-break:break-all}
a.btn{display:inline-block;margin-top:1.25rem;padding:.65rem 1.5rem;background:#3b82f6;color:#fff;border-radius:8px;text-decoration:none;font-weight:500;font-size:.95rem}
a.btn:hover{background:#2563eb}
</style>
</head>
<body>
<div class="card">
  <div class="icon" id="icon">⬇️</div>
  <h1 id="title">Starting download…</h1>
  <p id="msg">Preparing <span class="filename">${escapedFilename}</span></p>
  <a class="btn" href="${escapedUrl}" id="manual">Download manually</a>
</div>
<script>
window.addEventListener('DOMContentLoaded', function() {
  var iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:absolute;width:1px;height:1px;left:-9999px;top:-9999px';
  iframe.src = "${escapedUrl}";
  document.body.appendChild(iframe);
  document.getElementById('title').textContent = 'Download started';
  document.getElementById('msg').innerHTML = 'Your file <span class="filename">${escapedFilename}</span> is downloading. You can close this tab.';
  document.getElementById('icon').textContent = '✅';
});
</script>
</body>
</html>`,
      { headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  const rangeHeader = c.req.header("range");
  const object = await c.env.ASSET_BUCKET.get(key, rangeHeader ? { range: c.req.raw.headers } : undefined);
  if (!object) return new Response("File not found or link expired.", { status: 410, headers: { "Content-Type": "text/plain" } });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("Accept-Ranges", "bytes");
  const preview = c.req.query("preview") === "1";
  if (!preview) {
    headers.set("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  }
  headers.set("X-Content-Type-Options", "nosniff");
  const status = rangeHeader ? 206 : 200;
  return new Response(object.body, { status, headers });
});

export default files;

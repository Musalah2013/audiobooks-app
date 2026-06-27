import { useState, useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';

interface Props {
  /** Authenticated URL to fetch the audio from (e.g. /api/files/... or a presigned URL) */
  src: string;
  className?: string;
}

/**
 * Fetches audio via JS (so session cookies / auth headers are sent), converts
 * to a blob URL, then hands it to a native <audio> element. This sidesteps
 * the browser's inability to attach session cookies to <audio src> media
 * requests on authenticated endpoints.
 */
export function AudioPlayer({ src, className = '' }: Props) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const prevUrl = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBlobUrl(null);
    setError(null);

    fetch(src, { credentials: 'include', cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        let blob = await res.blob();
        if (cancelled) return;
        // If the stored Content-Type isn't audio (e.g. octet-stream), the <audio>
        // element won't play it — re-wrap with a MIME inferred from the extension.
        if (!blob.type.startsWith('audio')) {
          const ext = (src.split('?')[0].match(/\.(mp3|m4a|m4b|wav|flac|aac|ogg)$/i)?.[1] ?? 'mp3').toLowerCase();
          const mime: Record<string, string> = { mp3: 'audio/mpeg', m4a: 'audio/mp4', m4b: 'audio/mp4', wav: 'audio/wav', flac: 'audio/flac', aac: 'audio/aac', ogg: 'audio/ogg' };
          blob = new Blob([await blob.arrayBuffer()], { type: mime[ext] ?? 'audio/mpeg' });
          if (cancelled) return;
        }
        const url = URL.createObjectURL(blob);
        prevUrl.current = url;
        setBlobUrl(url);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load audio');
      });

    return () => {
      cancelled = true;
      if (prevUrl.current) {
        URL.revokeObjectURL(prevUrl.current);
        prevUrl.current = null;
      }
    };
  }, [src]);

  if (error) {
    return (
      <div className={`text-xs text-red-500 flex items-center gap-1.5 py-2 ${className}`}>
        <span>⚠</span> {error}
      </div>
    );
  }

  if (!blobUrl) {
    return (
      <div className={`flex items-center gap-2 text-xs text-slate-400 py-2 ${className}`}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading audio…
      </div>
    );
  }

  return <audio controls className={`w-full ${className}`} src={blobUrl} />;
}

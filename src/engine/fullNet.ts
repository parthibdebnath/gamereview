/**
 * Loads the full-strength Stockfish build (113 MB, full NNUE net), which is shipped as gzip
 * parts (scripts/copy-engine.mjs). Downloads once per session (the service worker caches the
 * parts for offline use), decompresses in the browser and hands every engine worker the same
 * in-memory Blob URL.
 */
export interface FullNetManifest {
  size: number;
  gzipSize: number;
  sha256: string;
  parts: { file: string; size: number }[];
}

export interface DownloadProgress {
  loaded: number;
  total: number;
}

let blobUrl: Promise<string> | undefined;
const listeners = new Set<(p: DownloadProgress) => void>();

export function onFullNetProgress(cb: (p: DownloadProgress) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function fullNetSupported(): boolean {
  return typeof DecompressionStream !== 'undefined' && typeof Blob !== 'undefined';
}

async function download(base: string): Promise<string> {
  const mres = await fetch(base + 'full-manifest.json');
  if (!mres.ok) throw new Error(`engine manifest: HTTP ${mres.status}`);
  const manifest = (await mres.json()) as FullNetManifest;
  const total = manifest.gzipSize;
  let loaded = 0;
  const chunks: BlobPart[] = [];
  for (const part of manifest.parts) {
    const res = await fetch(base + part.file);
    if (!res.ok || !res.body) throw new Error(`engine download: HTTP ${res.status}`);
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      for (const l of listeners) l({ loaded, total });
    }
  }
  const gz = new Blob(chunks);
  const wasm = await new Response(gz.stream().pipeThrough(new DecompressionStream('gzip'))).blob();
  if (wasm.size !== manifest.size) throw new Error('engine download is incomplete; please retry');
  return URL.createObjectURL(new Blob([wasm], { type: 'application/wasm' }));
}

/** Blob URL of the decompressed full-strength wasm (downloads on first call). */
export function fullNetUrl(base: string): Promise<string> {
  blobUrl ??= download(base).catch((e) => {
    blobUrl = undefined;
    throw e;
  });
  return blobUrl;
}

/**
 * Syncr Audio Cache Service
 *
 * Caches audio files in the browser Cache API and exposes blob URLs for
 * instant seeking. Works like Spotify's local cache:
 *   - First play streams from the network (immediate start, no wait)
 *   - Background download runs in parallel and stores the file locally
 *   - Subsequent plays serve the blob URL (instant seek, zero network)
 */

const CACHE_NAME = "syncr-audio-v1";
const MAX_CONCURRENT = 3;

type AuthGetter = () => Promise<Record<string, string>>;
export type CacheProgressCallback = (downloaded: number, total: number) => void;

class AudioCacheService {
  /** In-memory map: audioUrl → object URL (ready for audio.src) */
  private blobUrls = new Map<string, string>();

  /** URLs currently being downloaded — prevents duplicate fetches */
  private downloading = new Set<string>();

  /** Async function that returns auth headers (set from ClerkAuthTokenSetter) */
  private authGetter: AuthGetter | null = null;

  /** AbortController per batch — lets us cancel on unmount */
  private batchControllers = new Map<string, AbortController>();

  // ── Configuration ──────────────────────────────────────────────────────────

  setAuthGetter(getter: AuthGetter | null) {
    this.authGetter = getter;
  }

  isSupported(): boolean {
    return typeof window !== "undefined" && "caches" in window;
  }

  // ── URL helpers ─────────────────────────────────────────────────────────────

  toAudioUrl(fileUrl: string): string {
    return `/api/storage${fileUrl}`;
  }

  private async authHeaders(): Promise<HeadersInit> {
    if (!this.authGetter) return {};
    try {
      return await this.authGetter();
    } catch {
      return {};
    }
  }

  // ── Synchronous accessors (safe to call in render/callbacks) ───────────────

  /**
   * Returns the in-memory blob URL if already loaded, otherwise null.
   * Never blocks — always call before getPlaybackUrl to decide strategy.
   */
  getBlobUrl(fileUrl: string): string | null {
    return this.blobUrls.get(this.toAudioUrl(fileUrl)) ?? null;
  }

  /**
   * Returns the best playback URL right now:
   *   - If a blob URL is in memory → return it (instant seek)
   *   - Otherwise → return the network URL (streams immediately)
   */
  getPlaybackUrl(fileUrl: string): string {
    const audioUrl = this.toAudioUrl(fileUrl);
    return this.blobUrls.get(audioUrl) ?? audioUrl;
  }

  /**
   * Async version: checks Cache API if the blob is not in memory.
   * Resolves with a blob URL (instant seek) if cached, otherwise the network URL.
   * Uses a timeout so the audio element never waits more than `timeoutMs` —
   * well within the ~1s user-gesture window that browsers allow for audio.play().
   */
  async getPlaybackUrlAsync(fileUrl: string, timeoutMs = 250): Promise<string> {
    const audioUrl = this.toAudioUrl(fileUrl);
    // Already in memory — instant
    if (this.blobUrls.has(audioUrl)) return this.blobUrls.get(audioUrl)!;
    // Not cached at all — skip async wait
    if (!this.isSupported()) return audioUrl;
    try {
      const blobUrl = await Promise.race<string | null>([
        this.preloadBlobUrl(fileUrl),
        new Promise<null>(resolve => setTimeout(() => resolve(null), timeoutMs)),
      ]);
      if (blobUrl) return blobUrl;
    } catch {}
    return audioUrl;
  }

  // ── Async operations ────────────────────────────────────────────────────────

  /** Check Cache API without loading the blob into memory */
  async isCached(fileUrl: string): Promise<boolean> {
    if (!this.isSupported()) return false;
    const audioUrl = this.toAudioUrl(fileUrl);
    if (this.blobUrls.has(audioUrl)) return true;
    try {
      const cache = await caches.open(CACHE_NAME);
      return !!(await cache.match(audioUrl));
    } catch {
      return false;
    }
  }

  /**
   * Load a previously cached file into the in-memory blob URL map.
   * Called proactively for tracks that are likely to be played soon.
   */
  async preloadBlobUrl(fileUrl: string): Promise<string | null> {
    const audioUrl = this.toAudioUrl(fileUrl);
    if (this.blobUrls.has(audioUrl)) return this.blobUrls.get(audioUrl)!;
    if (!this.isSupported()) return null;
    try {
      const cache = await caches.open(CACHE_NAME);
      const match = await cache.match(audioUrl);
      if (match) {
        const blob = await match.blob();
        const blobUrl = URL.createObjectURL(blob);
        this.blobUrls.set(audioUrl, blobUrl);
        return blobUrl;
      }
    } catch {}
    return null;
  }

  /**
   * Download a single track, store in Cache API, and populate the blob URL map.
   * Safe to call redundantly — de-duped by the `downloading` set.
   *
   * @param onProgress  0→1 progress callback (per-track)
   * @param signal      AbortSignal to cancel
   */
  async cacheTrack(
    fileUrl: string,
    onProgress?: (pct: number) => void,
    signal?: AbortSignal
  ): Promise<boolean> {
    const audioUrl = this.toAudioUrl(fileUrl);

    if (this.blobUrls.has(audioUrl)) {
      onProgress?.(1);
      return true;
    }

    if (this.downloading.has(audioUrl)) return false;

    if (!this.isSupported()) return false;

    // Already in persistent cache from a previous session — just load it
    const alreadyCached = await this.isCached(fileUrl);
    if (alreadyCached) {
      await this.preloadBlobUrl(fileUrl);
      onProgress?.(1);
      return true;
    }

    if (signal?.aborted) return false;

    this.downloading.add(audioUrl);
    try {
      const response = await fetch(audioUrl, {
        headers: await this.authHeaders(),
      });
      if (!response.ok || !response.body) return false;

      const contentLength = Number(response.headers.get("content-length") || 0);
      const contentType =
        response.headers.get("content-type") || "audio/mpeg";

      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let loaded = 0;

      while (true) {
        if (signal?.aborted) {
          reader.cancel();
          return false;
        }
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        if (contentLength > 0 && onProgress) {
          onProgress(loaded / contentLength);
        }
      }

      const blob = new Blob(chunks, { type: contentType });

      // Persist to Cache API for future sessions
      await caches
        .open(CACHE_NAME)
        .then((cache) =>
          cache.put(
            audioUrl,
            new Response(blob.slice(0), {
              headers: { "content-type": contentType },
            })
          )
        )
        .catch(() => {});

      // Make immediately available as an object URL
      const blobUrl = URL.createObjectURL(blob);
      this.blobUrls.set(audioUrl, blobUrl);

      onProgress?.(1);
      return true;
    } catch {
      return false;
    } finally {
      this.downloading.delete(audioUrl);
    }
  }

  /**
   * Download a list of tracks in parallel (up to MAX_CONCURRENT at a time).
   * Returns a batch ID that can be used to cancel the batch.
   */
  batchCache(
    fileUrls: string[],
    options?: {
      onProgress?: CacheProgressCallback;
      onItemComplete?: (fileUrl: string) => void;
      batchId?: string;
    }
  ): AbortController {
    const { onProgress, onItemComplete, batchId } = options ?? {};
    const controller = new AbortController();
    const id = batchId ?? Math.random().toString(36).slice(2);
    this.batchControllers.set(id, controller);

    (async () => {
      if (!this.isSupported() || fileUrls.length === 0) return;

      let completed = 0;
      const total = fileUrls.length;
      const queue = [...fileUrls];

      const worker = async () => {
        while (queue.length > 0 && !controller.signal.aborted) {
          const fileUrl = queue.shift()!;
          await this.cacheTrack(fileUrl, undefined, controller.signal);
          completed++;
          onItemComplete?.(fileUrl);
          onProgress?.(completed, total);
        }
      };

      const concurrency = Math.min(MAX_CONCURRENT, fileUrls.length);
      await Promise.all(Array.from({ length: concurrency }, worker));
      this.batchControllers.delete(id);
    })();

    return controller;
  }

  /**
   * Preload blob URLs for tracks that are already cached.
   * Called when a sequence is selected so the first play is always instant.
   */
  async preloadSequence(fileUrls: string[]): Promise<void> {
    await Promise.all(fileUrls.map((f) => this.preloadBlobUrl(f)));
  }

  /** Cancel an ongoing batch */
  cancelBatch(batchId: string) {
    this.batchControllers.get(batchId)?.abort();
    this.batchControllers.delete(batchId);
  }

  /** How many of a list are already available locally */
  async countCached(fileUrls: string[]): Promise<number> {
    const results = await Promise.all(fileUrls.map((f) => this.isCached(f)));
    return results.filter(Boolean).length;
  }
}

export const audioCacheService = new AudioCacheService();

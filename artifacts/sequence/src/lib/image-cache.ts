/**
 * Syncr Image Cache Service
 *
 * Caches cover images in the browser Cache API as blob URLs so they load
 * instantly on every visit — no shimmer after the first load.
 *
 * Flow:
 *   1. getBlobUrl()  — sync, returns in-memory blob URL or null
 *   2. preload()     — reads Cache API, populates memory map if found
 *   3. cacheImage()  — fetches from network, stores in Cache API + memory
 */

const CACHE_NAME = "syncr-images-v1";

/**
 * Some legacy track records store cover URLs as bare `/objects/...` paths
 * (without the `/api/storage` proxy prefix). Normalize so they fetch correctly.
 * Absolute URLs and already-prefixed paths pass through unchanged.
 */
export function resolveCoverUrl(url: string): string {
  if (!url) return url;
  if (url.startsWith("/objects/")) return `/api/storage${url}`;
  return url;
}

type AuthGetter = () => Promise<Record<string, string>>;

class ImageCacheService {
  private blobUrls = new Map<string, string>();
  private inFlight = new Map<string, Promise<string | null>>();
  private authGetter: AuthGetter | null = null;

  setAuthGetter(getter: AuthGetter | null) {
    this.authGetter = getter;
  }

  private isSupported(): boolean {
    return typeof window !== "undefined" && "caches" in window;
  }

  private async authHeaders(): Promise<HeadersInit> {
    if (!this.authGetter) return {};
    try { return await this.authGetter(); } catch { return {}; }
  }

  /** Returns cached blob URL if in memory — instant, synchronous. */
  getBlobUrl(url: string): string | null {
    return this.blobUrls.get(url) ?? null;
  }

  /**
   * Reads the Cache API and populates the in-memory map if found.
   * Returns the blob URL or null if not yet cached.
   */
  async preload(url: string): Promise<string | null> {
    const existing = this.blobUrls.get(url);
    if (existing) return existing;
    if (!this.isSupported()) return null;
    try {
      const cache = await caches.open(CACHE_NAME);
      const match = await cache.match(url);
      if (match) {
        const blob = await match.blob();
        const blobUrl = URL.createObjectURL(blob);
        this.blobUrls.set(url, blobUrl);
        return blobUrl;
      }
    } catch {}
    return null;
  }

  /**
   * Fetches the image (from Cache API or network), stores it, and returns
   * a blob URL. De-duplicated — multiple calls for the same URL share one fetch.
   */
  cacheImage(url: string): Promise<string | null> {
    const existing = this.blobUrls.get(url);
    if (existing) return Promise.resolve(existing);

    const inflight = this.inFlight.get(url);
    if (inflight) return inflight;

    const promise = this._doCache(url).finally(() => {
      this.inFlight.delete(url);
    });
    this.inFlight.set(url, promise);
    return promise;
  }

  private async _doCache(url: string): Promise<string | null> {
    // Cache API hit — no network needed
    const preloaded = await this.preload(url);
    if (preloaded) return preloaded;

    if (!this.isSupported()) return null;

    try {
      const headers = await this.authHeaders();
      const response = await fetch(resolveCoverUrl(url), { headers });
      if (!response.ok) return null;

      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      this.blobUrls.set(url, blobUrl);

      // Persist to Cache API for future sessions
      caches.open(CACHE_NAME).then(cache =>
        cache.put(url, new Response(blob.slice(0), {
          headers: { "content-type": blob.type || "image/jpeg" },
        }))
      ).catch(() => {});

      return blobUrl;
    } catch {
      return null;
    }
  }
}

export const imageCacheService = new ImageCacheService();

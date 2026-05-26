/**
 * Shared fetch wrapper with timeout and optional retry.
 *
 * Retry is ONLY used for free/non-billable calls:
 * - Companies House 429s (free API, rate limited)
 * - Website HTML fetches (free)
 * - DataForSEO task_get (reading results, free)
 * - PageSpeed Insights (free)
 *
 * NEVER retry DataForSEO task_post or live endpoints (costs money per request).
 */

export interface FetchConfig {
  /** AbortController timeout in ms. Default: 10000 */
  timeoutMs?: number;
  /** Number of retry attempts after the first failure. Default: 0 (no retry) */
  retries?: number;
  /** Base delay between retries in ms (exponential backoff). Default: 1000 */
  retryDelayMs?: number;
  /** Predicate: which HTTP responses should trigger a retry. Default: none */
  retryOn?: (response: Response) => boolean;
}

export async function robustFetch(
  url: string,
  init?: RequestInit,
  config?: FetchConfig
): Promise<Response> {
  const {
    timeoutMs = 10000,
    retries = 0,
    retryDelayMs = 1000,
    retryOn,
  } = config || {};

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);

      if (retryOn?.(res) && attempt < retries) {
        await new Promise((r) => setTimeout(r, retryDelayMs * 2 ** attempt));
        continue;
      }

      return res;
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, retryDelayMs * 2 ** attempt));
        continue;
      }
    }
  }

  throw lastError;
}

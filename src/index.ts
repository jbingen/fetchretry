const DEFAULT_RETRIES = 3;
const DEFAULT_DELAY = 1000;
const DEFAULT_BACKOFF = 2;
const DEFAULT_TIMEOUT = 30_000;

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export type RetryOptions = {
  retries?: number;
  delay?: number;
  backoff?: number;
  timeout?: number;
  retryOn?: (response: Response, attempt: number) => boolean;
  onRetry?: (error: unknown, attempt: number) => void;
  signal?: AbortSignal;
};

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export function createFetchRetry(defaults?: RetryOptions & { fetch?: FetchFn }) {
  const baseFetch = defaults?.fetch ?? globalThis.fetch;
  const baseOpts = defaults;

  return function fetchRetry(url: string, init?: RequestInit & RetryOptions): Promise<Response> {
    const retries = init?.retries ?? baseOpts?.retries ?? DEFAULT_RETRIES;
    const delay = init?.delay ?? baseOpts?.delay ?? DEFAULT_DELAY;
    const backoff = init?.backoff ?? baseOpts?.backoff ?? DEFAULT_BACKOFF;
    const timeout = init?.timeout ?? baseOpts?.timeout ?? DEFAULT_TIMEOUT;
    const retryOn = init?.retryOn ?? baseOpts?.retryOn;
    const onRetry = init?.onRetry ?? baseOpts?.onRetry;
    const externalSignal = init?.signal ?? baseOpts?.signal;

    return attempt(0);

    async function attempt(n: number): Promise<Response> {
      const controller = new AbortController();

      if (externalSignal?.aborted) throw externalSignal.reason ?? new DOMException('Aborted', 'AbortError');
      externalSignal?.addEventListener('abort', () => controller.abort(externalSignal.reason), { once: true });

      const timer = setTimeout(() => controller.abort(new DOMException('Timeout', 'TimeoutError')), timeout);

      let response: Response;
      try {
        response = await baseFetch(url, { ...init, signal: controller.signal });
      } catch (err) {
        clearTimeout(timer);
        if (n < retries && !externalSignal?.aborted) {
          onRetry?.(err, n + 1);
          await sleep(delay * backoff ** n);
          return attempt(n + 1);
        }
        throw err;
      }

      clearTimeout(timer);

      const shouldRetry = retryOn
        ? retryOn(response, n + 1)
        : RETRYABLE_STATUS.has(response.status);

      if (shouldRetry && n < retries) {
        onRetry?.(response, n + 1);

        const retryAfter = parseRetryAfter(response);
        await sleep(retryAfter ?? delay * backoff ** n);

        return attempt(n + 1);
      }

      return response;
    }
  };
}

export const fetchRetry = createFetchRetry();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(response: Response): number | null {
  const header = response.headers.get('retry-after');
  if (!header) return null;

  const seconds = Number(header);
  if (!Number.isNaN(seconds)) return seconds * 1000;

  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());

  return null;
}

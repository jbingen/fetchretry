import { describe, test, expect, mock } from 'bun:test';
import { createFetchRetry, fetchRetry } from '../src/index';

function mockResponse(status: number, headers?: Record<string, string>): Response {
  return new Response(null, { status, headers });
}

function mockFetch(responses: Response[]) {
  let call = 0;
  return mock((_url: string, _init?: RequestInit) => {
    const res = responses[call++];
    if (!res) return Promise.reject(new Error('no more responses'));
    return Promise.resolve(res);
  });
}

function failThenSucceed(failures: number, finalStatus = 200) {
  const responses = [
    ...Array.from({ length: failures }, () => mockResponse(503)),
    mockResponse(finalStatus),
  ];
  return mockFetch(responses);
}

describe('retry behavior', () => {
  test('returns immediately on success', async () => {
    const fn = mockFetch([mockResponse(200)]);
    const fetch = createFetchRetry({ fetch: fn, delay: 0 });

    const res = await fetch('https://example.com');
    expect(res.status).toBe(200);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('retries on 503 and succeeds', async () => {
    const fn = failThenSucceed(2);
    const fetch = createFetchRetry({ fetch: fn, delay: 0 });

    const res = await fetch('https://example.com');
    expect(res.status).toBe(200);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test('gives up after max retries', async () => {
    const fn = mockFetch([mockResponse(503), mockResponse(503), mockResponse(503), mockResponse(503)]);
    const fetch = createFetchRetry({ fetch: fn, delay: 0, retries: 3 });

    const res = await fetch('https://example.com');
    expect(res.status).toBe(503);
    expect(fn).toHaveBeenCalledTimes(4);
  });

  test('does not retry on 400', async () => {
    const fn = mockFetch([mockResponse(400)]);
    const fetch = createFetchRetry({ fetch: fn, delay: 0 });

    const res = await fetch('https://example.com');
    expect(res.status).toBe(400);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('retries on network error', async () => {
    let call = 0;
    const fn = mock((_url: string, _init?: RequestInit) => {
      if (call++ < 2) return Promise.reject(new Error('network'));
      return Promise.resolve(mockResponse(200));
    });
    const fetch = createFetchRetry({ fetch: fn, delay: 0 });

    const res = await fetch('https://example.com');
    expect(res.status).toBe(200);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test('throws after exhausting retries on network error', async () => {
    const fn = mock((_url: string, _init?: RequestInit) => Promise.reject(new Error('network')));
    const fetch = createFetchRetry({ fetch: fn, delay: 0, retries: 2 });

    await expect(fetch('https://example.com')).rejects.toThrow('network');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe('retryOn', () => {
  test('custom retryOn controls retry decision', async () => {
    const fn = mockFetch([mockResponse(401), mockResponse(401), mockResponse(200)]);
    const fetch = createFetchRetry({
      fetch: fn,
      delay: 0,
      retryOn: (res) => res.status === 401,
    });

    const res = await fetch('https://example.com');
    expect(res.status).toBe(200);
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe('onRetry', () => {
  test('calls onRetry with attempt number', async () => {
    const fn = failThenSucceed(2);
    const attempts: number[] = [];
    const fetch = createFetchRetry({
      fetch: fn,
      delay: 0,
      onRetry: (_err, attempt) => attempts.push(attempt),
    });

    await fetch('https://example.com');
    expect(attempts).toEqual([1, 2]);
  });
});

describe('retry-after header', () => {
  test('respects retry-after in seconds', async () => {
    const fn = mockFetch([
      mockResponse(429, { 'retry-after': '0' }),
      mockResponse(200),
    ]);
    const fetch = createFetchRetry({ fetch: fn, delay: 10_000 });

    const start = Date.now();
    await fetch('https://example.com');
    expect(Date.now() - start).toBeLessThan(1000);
  });
});

describe('timeout', () => {
  test('aborts after timeout', async () => {
    const fn = mock((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_, reject) => {
        const onAbort = () => reject(init?.signal?.reason ?? new Error('aborted'));
        if (init?.signal?.aborted) return onAbort();
        init?.signal?.addEventListener('abort', onAbort);
      });
    });

    const fetch = createFetchRetry({ fetch: fn, timeout: 50, retries: 0 });

    await expect(fetch('https://example.com')).rejects.toThrow();
  });
});

describe('abort signal', () => {
  test('respects external abort signal', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(fetchRetry('https://example.com', { signal: controller.signal })).rejects.toThrow();
  });
});

describe('per-request overrides', () => {
  test('overrides retries per request', async () => {
    const fn = mockFetch([mockResponse(503), mockResponse(503)]);
    const fetch = createFetchRetry({ fetch: fn, delay: 0, retries: 5 });

    const res = await fetch('https://example.com', { retries: 1 });
    expect(res.status).toBe(503);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('default export', () => {
  test('fetchRetry is a pre-configured instance', () => {
    expect(typeof fetchRetry).toBe('function');
  });
});

# 🔁 fetchretry

[![npm version](https://img.shields.io/npm/v/@jbingen/fetchretry)](https://www.npmjs.com/package/@jbingen/fetchretry)
[![npm bundle size](https://img.shields.io/npm/unpacked-size/@jbingen/fetchretry)](https://www.npmjs.com/package/@jbingen/fetchretry)
[![license](https://img.shields.io/github/license/jbingen/fetchretry)](https://github.com/jbingen/fetchretry/blob/main/LICENSE)

Tiny fetch wrapper with retries, exponential backoff, timeout, and abort support.

For anyone tired of writing try/catch/sleep loops around every API call.

```
npm install @jbingen/fetchretry
```

```typescript
// before
let res, attempts = 0;
while (attempts < 3) {
  try { res = await fetch(url); if (res.ok) break; } catch {}
  await new Promise(r => setTimeout(r, 1000 * 2 ** attempts++));
}

// after
const res = await fetchRetry(url);
```

Returns a standard `Response`. Works everywhere `fetch` works.

```typescript
import { fetchRetry } from "@jbingen/fetchretry";

const res = await fetchRetry("https://api.example.com/data");

const res = await fetchRetry("https://api.example.com/data", {
  retries: 5,
  delay: 500,
  timeout: 10_000,
});
```

## Why

Every production app needs retry logic for HTTP calls. Transient 503s, rate limits, network blips - they all need the same pattern: retry with backoff, respect `Retry-After`, time out eventually, and let the caller abort.

Everyone writes this. Nobody writes it the same way twice. fetchretry does it with zero dependencies.

## API

### `fetchRetry(url, init?)`

Pre-configured instance using global `fetch`. Drop-in replacement with retry defaults.

```typescript
import { fetchRetry } from "@jbingen/fetchretry";

const res = await fetchRetry("https://api.example.com/data");
```

### `createFetchRetry(defaults?)`

Creates a configured instance. Use this to set base options or provide a custom fetch.

```typescript
import { createFetchRetry } from "@jbingen/fetchretry";

const apiFetch = createFetchRetry({
  retries: 5,
  delay: 500,
  timeout: 10_000,
});

const res = await apiFetch("https://api.example.com/data");
```

Per-request options override the defaults:

```typescript
const res = await apiFetch("https://api.example.com/data", {
  retries: 1,
  timeout: 5_000,
});
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `retries` | `number` | `3` | Max retry attempts |
| `delay` | `number` | `1000` | Base delay in ms before first retry |
| `backoff` | `number` | `2` | Multiplier for exponential backoff |
| `timeout` | `number` | `30000` | Per-request timeout in ms |
| `retryOn` | `(res, attempt) => boolean` | status-based | Custom retry predicate |
| `onRetry` | `(error, attempt) => void` | - | Called before each retry |
| `signal` | `AbortSignal` | - | External abort signal |

### Default retry behavior

Retries on these status codes: `408`, `429`, `500`, `502`, `503`, `504`.

Retries on network errors (fetch throws).

Does not retry on client errors (`4xx` other than `408`/`429`).

Override with `retryOn` for custom logic:

```typescript
const fetch = createFetchRetry({
  retryOn: (res) => res.status >= 500 || res.status === 401,
});
```

### Retry-After

When the server sends a `Retry-After` header, fetchretry respects it instead of using the calculated backoff delay. Supports both seconds (`120`) and HTTP-date formats.

### Timeout

Each attempt has its own timeout. If a request takes longer than `timeout` ms, it's aborted and counts as a failed attempt (triggering a retry if attempts remain).

```typescript
const fetch = createFetchRetry({ timeout: 5_000 });
```

### Abort

Pass an `AbortSignal` to cancel the entire retry chain. Once aborted, no further retries are attempted.

```typescript
const controller = new AbortController();
setTimeout(() => controller.abort(), 15_000);

const res = await fetchRetry(url, { signal: controller.signal });
```

### Custom fetch

Provide your own fetch implementation (useful for testing or platforms with non-standard fetch):

```typescript
const fetch = createFetchRetry({
  fetch: myCustomFetch,
});
```

## Design decisions

- Zero dependencies. Tiny footprint.
- Returns a standard `Response` - no custom wrapper, no `.json()` override, no magic.
- Exponential backoff by default, `Retry-After` takes precedence when present.
- Timeout is per-attempt, not total. Each retry gets a fresh timeout window.
- External abort signal cancels the entire chain, not just the current attempt.
- Retryable status codes match common CDN/proxy behavior (408, 429, 5xx).
- `createFetchRetry` for configured instances, `fetchRetry` for quick one-offs.

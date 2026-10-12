import { env } from '../config/env.js';
import { retryWithBackoff } from '../utils/retry.js';

const SEARCH_ENDPOINT = 'https://api.search.tinyfish.ai';
const FETCH_ENDPOINT = 'https://api.fetch.tinyfish.ai';

export class TinyFishError extends Error {
  constructor(message, { status = 0, code = 'tinyfish_error' } = {}) {
    super(message);
    this.name = 'TinyFishError';
    this.status = status;
    this.code = code;
  }
}

async function requestJson(url, options, { signal } = {}) {
  if (!env.tinyfishApiKey) {
    throw new TinyFishError('TINYFISH_API_KEY is required for live research.', {
      code: 'tinyfish_not_configured',
    });
  }

  return retryWithBackoff(async ({ signal: attemptSignal }) => {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        'X-API-Key': env.tinyfishApiKey,
      },
      signal: attemptSignal,
    });
    const raw = await response.text();
    let payload;
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      throw new TinyFishError('TinyFish returned an invalid JSON response.', {
        status: response.status,
        code: 'tinyfish_invalid_response',
      });
    }

    if (!response.ok) {
      const message = typeof payload.error === 'string'
        ? payload.error
        : typeof payload.message === 'string'
          ? payload.message
          : `TinyFish request failed with HTTP ${response.status}.`;
      throw new TinyFishError(message, {
        status: response.status,
        code: `tinyfish_http_${response.status}`,
      });
    }
    return payload;
  }, {
    retries: env.tinyfishRetries,
    baseMs: 300,
    maxMs: 2_000,
    timeoutMs: env.tinyfishTimeoutMs,
    signal,
    shouldRetry: (error) => !error.status || error.status === 429 || error.status >= 500,
  });
}

export async function searchTinyFish(query, { purpose, language = 'en', location, signal } = {}) {
  const normalizedQuery = String(query || '').trim();
  if (!normalizedQuery) throw new TypeError('A non-empty TinyFish search query is required.');

  const url = new URL(SEARCH_ENDPOINT);
  url.searchParams.set('query', normalizedQuery);
  url.searchParams.set('language', language);
  if (location) url.searchParams.set('location', location);
  if (purpose) url.searchParams.set('purpose', purpose);

  const payload = await requestJson(url, { method: 'GET', headers: {} }, { signal });
  if (!Array.isArray(payload.results)) {
    throw new TinyFishError('TinyFish search response did not contain a results array.', {
      code: 'tinyfish_invalid_response',
    });
  }

  return payload.results.flatMap((item, index) => {
    const safeUrl = normalizeHttpUrl(item?.url);
    if (!safeUrl || typeof item?.title !== 'string' || !item.title.trim()) return [];
    return [{
      position: Number.isInteger(item.position) ? item.position : index + 1,
      siteName: typeof item.site_name === 'string' ? item.site_name : '',
      title: item.title.trim(),
      snippet: typeof item.snippet === 'string' ? item.snippet.trim() : '',
      url: safeUrl,
      date: typeof item.date === 'string' ? item.date : null,
    }];
  });
}

export async function fetchTinyFishUrls(urls, { purpose, signal } = {}) {
  const safeUrls = [...new Set((urls || []).map(normalizeHttpUrl).filter(Boolean))].slice(0, 10);
  if (!safeUrls.length) return { results: [], errors: [] };

  const payload = await requestJson(FETCH_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      urls: safeUrls,
      format: 'markdown',
      purpose,
      per_url_timeout_ms: Math.max(1, Math.min(env.tinyfishTimeoutMs - 1_000, 20_000)),
    }),
  }, { signal });

  if (!Array.isArray(payload.results) || !Array.isArray(payload.errors)) {
    throw new TinyFishError('TinyFish fetch response did not contain results and errors arrays.', {
      code: 'tinyfish_invalid_response',
    });
  }

  const failedUrls = new Set(payload.errors.map((item) => normalizeHttpUrl(item?.url)).filter(Boolean));
  const results = payload.results.flatMap((item) => {
    const url = normalizeHttpUrl(item?.url);
    const finalUrl = normalizeHttpUrl(item?.final_url) || url;
    if (!url || failedUrls.has(url) || typeof item?.text !== 'string' || !item.text.trim()) return [];
    return [{
      url,
      finalUrl,
      title: typeof item.title === 'string' && item.title.trim() ? item.title.trim() : url,
      description: typeof item.description === 'string' ? item.description : '',
      publishedDate: typeof item.published_date === 'string' ? item.published_date : null,
      text: item.text.trim(),
    }];
  });
  const errors = payload.errors.flatMap((item) => {
    const url = normalizeHttpUrl(item?.url);
    if (!url) return [];
    return [{
      url,
      code: typeof item.error === 'string' ? item.error : 'fetch_failed',
    }];
  });
  return { results, errors };
}

function normalizeHttpUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

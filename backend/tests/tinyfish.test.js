import test from 'node:test';
import assert from 'node:assert/strict';
import { env } from '../src/config/env.js';
import { fetchTinyFishUrls, searchTinyFish, TinyFishError } from '../src/services/tinyfish.js';

function withTinyFishConfig(t, overrides = {}) {
  const original = {
    key: env.tinyfishApiKey,
    timeout: env.tinyfishTimeoutMs,
    retries: env.tinyfishRetries,
  };
  env.tinyfishApiKey = 'test-only-key';
  env.tinyfishTimeoutMs = 5_000;
  env.tinyfishRetries = 0;
  Object.assign(env, overrides);
  const originalFetch = globalThis.fetch;
  t.after(() => {
    env.tinyfishApiKey = original.key;
    env.tinyfishTimeoutMs = original.timeout;
    env.tinyfishRetries = original.retries;
    globalThis.fetch = originalFetch;
  });
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('TinyFish Search uses the documented endpoint, header, and response schema', async (t) => {
  withTinyFishConfig(t);
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url: new URL(url), options };
    return jsonResponse({
      query: 'scholarship criteria',
      results: [{
        position: 1,
        site_name: 'scholarships.gov.in',
        title: 'Official rules',
        snippet: 'Eligibility rules.',
        url: 'https://scholarships.gov.in/rules',
        date: '2025-01-01',
      }],
      total_results: 1,
      page: 0,
    });
  };

  const results = await searchTinyFish('scholarship criteria', { language: 'en', purpose: 'Answer a question' });

  assert.equal(request.url.origin, 'https://api.search.tinyfish.ai');
  assert.equal(request.url.searchParams.get('query'), 'scholarship criteria');
  assert.equal(request.url.searchParams.get('language'), 'en');
  assert.equal(request.options.method, 'GET');
  assert.equal(request.options.headers['X-API-Key'], 'test-only-key');
  assert.deepEqual(results[0], {
    position: 1,
    siteName: 'scholarships.gov.in',
    title: 'Official rules',
    snippet: 'Eligibility rules.',
    url: 'https://scholarships.gov.in/rules',
    date: '2025-01-01',
  });
});

test('TinyFish Fetch batches URLs using documented request and response fields', async (t) => {
  withTinyFishConfig(t);
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url: new URL(url), options };
    return jsonResponse({
      results: [{
        url: 'https://scholarships.gov.in/rules',
        final_url: 'https://scholarships.gov.in/rules',
        title: 'Official rules',
        description: 'Eligibility rules.',
        published_date: '2025-01-01',
        text: '# Official rules\nEvidence text.',
      }],
      errors: [{ url: 'https://example.com/unavailable', error: 'timeout' }],
    });
  };

  const fetched = await fetchTinyFishUrls([
    'https://scholarships.gov.in/rules',
    'https://example.com/unavailable',
    'https://scholarships.gov.in/rules',
  ], { purpose: 'Verify eligibility' });

  assert.equal(request.url.href, 'https://api.fetch.tinyfish.ai/');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers['X-API-Key'], 'test-only-key');
  assert.deepEqual(JSON.parse(request.options.body), {
    urls: ['https://scholarships.gov.in/rules', 'https://example.com/unavailable'],
    format: 'markdown',
    purpose: 'Verify eligibility',
    per_url_timeout_ms: 4_000,
  });
  assert.equal(fetched.results.length, 1);
  assert.equal(fetched.results[0].text, '# Official rules\nEvidence text.');
  assert.equal(fetched.results[0].publishedDate, '2025-01-01');
  assert.deepEqual(fetched.errors, [{ url: 'https://example.com/unavailable', code: 'timeout' }]);
});

test('TinyFish authentication failures surface explicitly without retrying', async (t) => {
  withTinyFishConfig(t);
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return jsonResponse({ error: 'Unauthorized' }, 401);
  };

  await assert.rejects(
    searchTinyFish('test'),
    (error) => error instanceof TinyFishError && error.status === 401,
  );
  assert.equal(calls, 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import pino from 'pino';
import { env } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { resetMemoryStore } from '../src/services/store/memory.js';
import { runResearch } from '../src/services/research.js';

const searchResults = [
  { position: 2, title: 'General guidance', url: 'https://example.com/info', snippet: 'General information.' },
  { position: 1, title: 'Official guidance', url: 'https://scholarships.gov.in/guide', snippet: 'Official criteria.' },
];
const fetchedSources = [
  {
    url: 'https://scholarships.gov.in/guide',
    finalUrl: 'https://scholarships.gov.in/guide',
    title: 'Official guidance',
    description: 'Official criteria.',
    publishedDate: null,
    text: 'Eligibility information from the official source.',
  },
];
const synthesis = {
  answer: 'Applicants must meet the criteria listed on the official scholarship page.',
  confidence: 'high',
  usedSourceUrls: ['https://scholarships.gov.in/guide'],
  needsMoreInfo: false,
};

function successfulProviders(overrides = {}) {
  return {
    rewriteQuestion: async (question) => ({ queries: [question] }),
    searchTinyFish: async () => searchResults,
    fetchTinyFishUrls: async () => ({ results: fetchedSources, errors: [] }),
    generateStructuredResponse: async () => synthesis,
    ...overrides,
  };
}

test('research pipeline ranks official sources, fetches evidence, cites it, and reports stages', async () => {
  const events = [];
  const result = await runResearch(
    { question: 'What are scholarship eligibility criteria?' },
    (event) => events.push(event.type),
    successfulProviders(),
  );

  assert.equal(result.status, 'completed');
  assert.equal(result.searchQuery, 'What are scholarship eligibility criteria?');
  assert.equal(result.sources[0].url, 'https://scholarships.gov.in/guide');
  assert.deepEqual(result.usedSourceUrls, ['https://scholarships.gov.in/guide']);
  assert.equal(result.citations[0].title, 'Official guidance');
  assert.ok(result.answerSegments.length >= 1);
  assert.ok(result.timings.totalMs >= 0);
  assert.deepEqual(events, [
    'received',
    'rewriting',
    'searching',
    'search_complete',
    'fetching',
    'fetch_complete',
    'synthesizing',
    'completed',
  ]);
});

test('research failure does not invent sources or return a success status', async () => {
  const result = await runResearch(
    { question: 'A factual question' },
    () => {},
    successfulProviders({
      searchTinyFish: async () => { throw Object.assign(new Error('provider unavailable'), { code: 'tinyfish_http_503' }); },
    }),
  );

  assert.equal(result.status, 'fallback');
  assert.equal(result.errorCode, 'tinyfish_http_503');
  assert.deepEqual(result.sources, []);
  assert.deepEqual(result.citations, []);
  assert.match(result.answer, /temporarily unavailable/i);
});

test('partial provider failures are surfaced when remaining sources support a cited answer', async () => {
  const events = [];
  const result = await runResearch(
    { question: 'Explain the policy' },
    (event) => events.push(event.type),
    successfulProviders({
      rewriteQuestion: async () => ({ queries: ['primary query', 'secondary query'] }),
      searchTinyFish: async (query) => {
        if (query === 'secondary query') throw Object.assign(new Error('provider unavailable'), { code: 'tinyfish_http_503' });
        return searchResults;
      },
      fetchTinyFishUrls: async () => ({
        results: fetchedSources,
        errors: [{ url: 'https://example.com/info', code: 'timeout' }],
      }),
    }),
  );

  assert.equal(result.status, 'completed');
  assert.deepEqual(result.warnings, ['1 search query failed.', '1 source page could not be fetched.']);
  assert.ok(events.includes('search_warning'));
  assert.ok(events.includes('fetch_warning'));
});

test('synthesis failure keeps verified source URLs and uses an honest fallback', async () => {
  const result = await runResearch(
    { question: 'Explain the policy' },
    () => {},
    successfulProviders({
      generateStructuredResponse: async () => { throw Object.assign(new Error('model unavailable'), { code: 'llm_http_503' }); },
    }),
  );

  assert.equal(result.status, 'fallback');
  assert.deepEqual(result.usedSourceUrls, []);
  assert.deepEqual(result.citations, []);
  assert.match(result.answerSegments.join(''), /https:\/\/scholarships\.gov\.in\/guide/);
});

test('research rejects uncited model output instead of presenting it as sourced', async () => {
  const result = await runResearch(
    { question: 'Explain the policy' },
    () => {},
    successfulProviders({
      generateStructuredResponse: async () => ({ ...synthesis, usedSourceUrls: [] }),
    }),
  );

  assert.equal(result.status, 'fallback');
  assert.equal(result.errorCode, 'research_no_citations');
  assert.equal(result.confidence, 'low');
});

test('research enforces the overall deadline and returns the honest fallback', async (t) => {
  const originalDeadline = env.researchTimeoutMs;
  env.researchTimeoutMs = 15;
  t.after(() => { env.researchTimeoutMs = originalDeadline; });

  const result = await runResearch(
    { question: 'A question that times out' },
    () => {},
    successfulProviders({
      rewriteQuestion: (_, __, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
    }),
  );

  assert.equal(result.status, 'fallback');
  assert.equal(result.errorCode, 'research_timeout');
  assert.ok(result.timings.totalMs >= 10);
});

test('research API accepts a run and streams progress plus its final fallback', async (t) => {
  resetMemoryStore();
  const oldKey = env.tinyfishApiKey;
  const oldProvider = env.llmProvider;
  env.tinyfishApiKey = '';
  env.llmProvider = 'mock';
  t.after(() => {
    env.tinyfishApiKey = oldKey;
    env.llmProvider = oldProvider;
  });

  const server = createApp({ logger: pino({ level: 'silent' }) }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/research`;
  const response = await fetch(baseUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question: 'A question with no live provider credentials' }),
  });

  assert.equal(response.status, 202);
  const { runId } = await response.json();
  const streamResponse = await fetch(`${baseUrl}/${runId}/stream`);
  const stream = await streamResponse.text();
  assert.match(stream, /event: connected/);
  assert.match(stream, /event: searching/);
  assert.match(stream, /event: failed/);
  assert.match(stream, /event: final/);
  assert.match(stream, /"status":"fallback"/);
});

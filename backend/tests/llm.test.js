import test from 'node:test';
import assert from 'node:assert/strict';
import { env } from '../src/config/env.js';
import { generateStructuredResponse, LlmError } from '../src/services/llm.js';

function withAnthropicConfig(t) {
  const original = {
    provider: env.llmProvider,
    key: env.llmApiKey,
    model: env.llmModel,
    timeout: env.llmTimeoutMs,
    retries: env.llmRetries,
  };
  const originalFetch = globalThis.fetch;
  env.llmProvider = 'anthropic';
  env.llmApiKey = 'test-only-key';
  env.llmTimeoutMs = 1_000;
  env.llmRetries = 0;
  t.after(() => {
    env.llmProvider = original.provider;
    env.llmApiKey = original.key;
    env.llmModel = original.model;
    env.llmTimeoutMs = original.timeout;
    env.llmRetries = original.retries;
    globalThis.fetch = originalFetch;
  });
}

function anthropicResponse(text) {
  return new Response(JSON.stringify({ content: [{ type: 'text', text }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

test('Anthropic synthesis strictly parses and retries malformed JSON once', async (t) => {
  withAnthropicConfig(t);
  const requests = [];
  const source = {
    url: 'https://example.gov/rules',
    title: 'Official rules',
    publishedDate: null,
    text: 'Applicants must submit a form.',
  };
  const answer = {
    answer: 'Applicants must submit a form.',
    confidence: 'high',
    usedSourceUrls: [source.url],
    needsMoreInfo: false,
  };
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options, body: JSON.parse(options.body) });
    return anthropicResponse(requests.length === 1 ? 'not json' : JSON.stringify(answer));
  };

  const result = await generateStructuredResponse({
    question: 'What must applicants submit?',
    language: 'en',
    sources: [source],
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(requests[0].options.headers['x-api-key'], 'test-only-key');
  assert.equal(requests[0].options.headers['anthropic-version'], '2023-06-01');
  assert.match(requests[0].body.system, /untrusted evidence/i);
  assert.deepEqual(result.usedSourceUrls, [source.url]);
  assert.equal(result.answer, answer.answer);
});

test('Anthropic synthesis rejects invalid answer schemas after one correction attempt', async (t) => {
  withAnthropicConfig(t);
  globalThis.fetch = async () => anthropicResponse(JSON.stringify({
    answer: 'Unsupported',
    confidence: 'certain',
    usedSourceUrls: [],
    needsMoreInfo: false,
  }));

  await assert.rejects(
    generateStructuredResponse({
      question: 'Question',
      language: 'en',
      sources: [{ url: 'https://example.com', title: 'Page', text: 'Evidence' }],
    }),
    (error) => error instanceof LlmError && error.code === 'llm_invalid_json',
  );
});

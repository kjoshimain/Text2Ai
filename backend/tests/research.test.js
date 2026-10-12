import test from 'node:test';
import assert from 'node:assert/strict';
import { runResearch } from '../src/services/research.js';

test('runResearch returns a normalized pipeline result with sources and answer', async () => {
  process.env.TINYFISH_MODE = 'mock';
  process.env.LLM_PROVIDER = 'mock';

  const result = await runResearch({
    question: 'What are the eligibility criteria for a government scholarship?',
    phone: '+919876543210',
    lang: 'en',
  });

  assert.equal(result.status, 'completed');
  assert.ok(Array.isArray(result.sources));
  assert.ok(result.sources.length > 0);
  assert.ok(result.answer.length > 0);
  assert.ok(['high', 'medium', 'low'].includes(result.confidence));
});

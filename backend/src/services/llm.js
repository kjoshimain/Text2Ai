import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.js';
import { retryWithBackoff } from '../utils/retry.js';

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const promptPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../prompts/research-system.txt');

export class LlmError extends Error {
  constructor(message, { status = 0, code = 'llm_error' } = {}) {
    super(message);
    this.name = 'LlmError';
    this.status = status;
    this.code = code;
  }
}

export async function getSystemPrompt() {
  return fs.readFile(promptPath, 'utf8');
}

export async function rewriteQuestion(question, language, { signal } = {}) {
  const cleanQuestion = String(question || '').trim();
  if (!cleanQuestion) throw new TypeError('A non-empty research question is required.');
  if (env.llmProvider === 'mock') return { queries: [cleanQuestion] };

  const result = await completeJson({
    system: 'Create web search queries for the user question. Do not answer it. Preserve the user intent, translate to English only if useful for search, and do not add facts. Return only JSON: {"queries":["query one","query two"]}.',
    user: JSON.stringify({ question: cleanQuestion, language }),
    maxTokens: 180,
    signal,
    validate: (value) => {
      if (!Array.isArray(value.queries) || !value.queries.length
        || value.queries.some((query) => typeof query !== 'string' || !query.trim())) {
        throw new TypeError('Expected non-empty search queries.');
      }
    },
  });
  return { queries: [...new Set(result.queries.map((query) => query.trim()))].slice(0, 2) };
}

export async function generateStructuredResponse({ question, sources, language }, { signal } = {}) {
  if (env.llmProvider === 'mock') {
    throw new LlmError('Set LLM_PROVIDER and LLM_API_KEY to enable factual answer synthesis.', {
      code: 'llm_not_configured',
    });
  }
  if (!Array.isArray(sources) || !sources.length) {
    throw new LlmError('At least one fetched source is required for answer synthesis.', {
      code: 'llm_missing_sources',
    });
  }

  const system = await getSystemPrompt();
  const allowedUrls = new Set(sources.map((source) => source.url));
  const user = JSON.stringify({
    question,
    language,
    sources: sources.map(({ title, url, publishedDate, text }) => ({
      title,
      url,
      publishedDate,
      text: String(text).slice(0, 6000),
    })),
  });
  const result = await completeJson({
    system,
    user,
    maxTokens: 500,
    signal,
    validate: (value) => {
      if (typeof value.answer !== 'string' || !value.answer.trim() || value.answer.trim().length > 450
        || !['high', 'medium', 'low'].includes(value.confidence)
        || !Array.isArray(value.usedSourceUrls)
        || value.usedSourceUrls.some((url) => typeof url !== 'string' || !allowedUrls.has(url))
        || typeof value.needsMoreInfo !== 'boolean') {
        throw new TypeError('The answer does not match the required source-backed schema.');
      }
    },
  });

  return {
    answer: result.answer.trim(),
    confidence: result.confidence,
    usedSourceUrls: [...new Set(result.usedSourceUrls)],
    needsMoreInfo: result.needsMoreInfo,
  };
}

async function completeJson({ system, user, maxTokens, signal, validate = () => {} }) {
  const first = await completeMessage({
    system,
    messages: [{ role: 'user', content: user }],
    maxTokens,
    signal,
  });
  try {
    const parsed = parseJsonObject(first);
    validate(parsed);
    return parsed;
  } catch {
    const repaired = await completeMessage({
      system,
      messages: [
        { role: 'user', content: user },
        { role: 'assistant', content: first },
        { role: 'user', content: 'Return a corrected response as one valid JSON object only. Preserve the required schema and do not add unsupported facts.' },
      ],
      maxTokens,
      signal,
    });
    try {
      const parsed = parseJsonObject(repaired);
      validate(parsed);
      return parsed;
    } catch {
      throw new LlmError('The language model did not return valid JSON after one correction attempt.', {
        code: 'llm_invalid_json',
      });
    }
  }
}

async function completeMessage({ system, messages, maxTokens, signal }) {
  if (env.llmProvider !== 'anthropic') {
    throw new LlmError(`Unsupported LLM_PROVIDER: ${env.llmProvider}.`, { code: 'llm_provider_unsupported' });
  }
  if (!env.llmApiKey) {
    throw new LlmError('LLM_API_KEY is required for Anthropic answer synthesis.', {
      code: 'llm_not_configured',
    });
  }

  return retryWithBackoff(async ({ signal: attemptSignal }) => {
    const response = await fetch(ANTHROPIC_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.llmApiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: env.llmModel,
        max_tokens: maxTokens,
        system,
        messages,
      }),
      signal: attemptSignal,
    });
    const raw = await response.text();
    let payload;
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      throw new LlmError('Anthropic returned an invalid JSON response.', {
        status: response.status,
        code: 'llm_invalid_response',
      });
    }
    if (!response.ok) {
      const message = typeof payload.error?.message === 'string'
        ? payload.error.message
        : `Anthropic request failed with HTTP ${response.status}.`;
      throw new LlmError(message, { status: response.status, code: `llm_http_${response.status}` });
    }
    const text = payload.content?.find((item) => item.type === 'text')?.text;
    if (typeof text !== 'string') {
      throw new LlmError('Anthropic response did not contain text content.', {
        code: 'llm_invalid_response',
      });
    }
    return text;
  }, {
    retries: env.llmRetries,
    baseMs: 300,
    maxMs: 1_500,
    timeoutMs: env.llmTimeoutMs,
    signal,
    shouldRetry: (error) => !error.status || error.status === 429 || error.status >= 500,
  });
}

function parseJsonObject(value) {
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('Expected a JSON object.');
  }
  return parsed;
}

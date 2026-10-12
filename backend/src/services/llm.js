import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const systemPromptPath = path.resolve(__dirname, '../prompts/research-system.txt');

export async function getSystemPrompt() {
  return fs.readFile(systemPromptPath, 'utf8');
}

export async function rewriteQuestion(question, language) {
  if (process.env.LLM_PROVIDER === 'mock' || !process.env.LLM_API_KEY) {
    const clean = String(question || '').trim();
    return clean.length > 80 ? clean.slice(0, 80) : clean;
  }

  return `Search for official information about: ${question}`;
}

export async function generateStructuredResponse({ question, sources, language }) {
  const fallback = {
    answer: 'I could not find a reliable answer from trusted sources. Please check the official site mentioned in the search results.',
    confidence: 'low',
    usedSourceUrls: sources?.slice(0, 2).map((item) => item.url || item.href || '')?.filter(Boolean) || [],
    needsMoreInfo: true,
  };

  if (process.env.LLM_PROVIDER === 'mock' || !process.env.LLM_API_KEY) {
    const sourceUrls = sources?.map((item) => item.url || item.href || '').filter(Boolean) || [];
    const answer = `The available evidence suggests that ${String(question || 'this topic').trim() || 'this topic'} needs review from an official source. Please check an official government or institutional page for definitive eligibility details.`;
    return {
      answer,
      confidence: sourceUrls.length ? 'medium' : 'low',
      usedSourceUrls: sourceUrls.slice(0, 3),
      needsMoreInfo: sourceUrls.length === 0,
    };
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.LLM_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: process.env.LLM_MODEL || 'claude-sonnet-4-20250514',
        max_tokens: 300,
        system: await getSystemPrompt(),
        messages: [{ role: 'user', content: JSON.stringify({ question, language, sources }) }],
      }),
    });

    if (!res.ok) {
      return fallback;
    }

    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || '{}');
    return {
      answer: parsed.answer || fallback.answer,
      confidence: parsed.confidence || 'low',
      usedSourceUrls: Array.isArray(parsed.usedSourceUrls) ? parsed.usedSourceUrls : fallback.usedSourceUrls,
      needsMoreInfo: !!parsed.needsMoreInfo,
    };
  } catch (error) {
    return fallback;
  }
}

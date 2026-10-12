import { v4 as uuid } from 'uuid';
import { searchTinyFish, fetchTinyFishUrls } from './tinyfish.js';
import { generateStructuredResponse, rewriteQuestion } from './llm.js';
import { detectLanguage, normalizeText } from '../utils/lang.js';
import { formatSmsReply } from '../utils/smsSegments.js';
import { sendSms } from './sms/index.js';
import { addResearchRun, getResearchRun } from './store/memory.js';

export async function runResearch({ question, phone, lang }, onProgress = () => {}) {
  const startedAt = Date.now();
  const result = {
    question: '',
    detectedLang: lang || 'en',
    searchQuery: '',
    sources: [],
    extracted: [],
    answer: '',
    answerSegments: [],
    confidence: 'low',
    status: 'in_progress',
    timings: {},
  };

  const cleanQuestion = normalizeText(question || '');
  result.question = cleanQuestion;
  result.detectedLang = lang || detectLanguage(cleanQuestion);
  onProgress({ type: 'received', payload: { question: cleanQuestion, detectedLang: result.detectedLang } });

  const queryRewritten = await rewriteQuestion(cleanQuestion, result.detectedLang);
  result.searchQuery = queryRewritten;
  onProgress({ type: 'query_rewrite', payload: { searchQuery: queryRewritten } });

  const searchResults = await searchTinyFish(queryRewritten);
  const ranked = rankResults(searchResults, cleanQuestion);
  result.sources = ranked.slice(0, 5).map((item) => ({
    title: item.title || 'Related result',
    url: item.url || '',
    snippet: item.snippet || '',
    selected: true,
  }));
  onProgress({ type: 'search', payload: { sources: result.sources } });

  const fetchTargets = result.sources.map((item) => item.url).filter(Boolean);
  const excerpts = await fetchTinyFishUrls(fetchTargets);
  result.extracted = excerpts.slice(0, 5).map((item) => ({
    url: item.final_url || item.url,
    excerpt: (item.text || '').slice(0, 600),
  }));
  onProgress({ type: 'fetch', payload: { extracted: result.extracted } });

  const response = await generateStructuredResponse({
    question: cleanQuestion,
    language: result.detectedLang,
    sources: result.sources,
  });

  result.answer = response.answer || 'Could not find a reliable answer right now. Please try again or rephrase.';
  result.confidence = response.confidence || 'low';
  const smsReply = formatSmsReply(result.answer, response.usedSourceUrls || result.sources.map((s) => s.url), 3);
  result.answerSegments = [smsReply.body];
  onProgress({ type: 'synthesize', payload: { answer: result.answer, confidence: result.confidence } });
  onProgress({ type: 'format', payload: { answerSegments: result.answerSegments } });

  result.status = 'completed';
  result.timings = {
    totalMs: Date.now() - startedAt,
  };

  onProgress({ type: 'delivered', payload: { status: 'queued', answer: result.answer } });

  return result;
}

export async function queueResearchReply({ question, phone, lang }) {
  const runId = uuid();
  const run = await runResearch({ question, phone, lang }, () => {});
  addResearchRun(runId, { runId, ...run, phone });
  return { runId, ...run };
}

function rankResults(results, query) {
  const normalized = String(query || '').toLowerCase();
  const officialDomains = ['gov.in', 'nic.in', '.gov', '.edu', 'ac.in'];
  return [...(results || [])].sort((a, b) => {
    const aScore = scoreResult(a, normalized, officialDomains);
    const bScore = scoreResult(b, normalized, officialDomains);
    return bScore - aScore;
  });
}

function scoreResult(item, query, officialDomains) {
  const url = String(item.url || '').toLowerCase();
  const text = String((item.snippet || item.title || '') + ' ' + (item.description || '')).toLowerCase();
  let score = 0;
  if (officialDomains.some((domain) => url.includes(domain))) score += 10;
  if (text.includes(query)) score += 4;
  if (url.includes('gov')) score += 3;
  if (url.includes('edu')) score += 2;
  return score;
}

export function getStoredRun(runId) {
  return getResearchRun(runId);
}

export async function sendReplyBySms({ to, answer, urls = [] }) {
  const payload = formatSmsReply(answer, urls, 3);
  const result = await sendSms({ to, body: payload.body});
  return { ...result, segments: payload.segments };
}

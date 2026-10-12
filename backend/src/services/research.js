import { v4 as uuid } from 'uuid';
import { formatSmsReply } from '../utils/smsSegments.js';
import { detectLanguage, normalizeText } from '../utils/lang.js';
import { sendSms } from './sms/index.js';
import { addResearchRun, getResearchRun } from './store/index.js';
import { env } from '../config/env.js';
import { fetchTinyFishUrls, searchTinyFish } from './tinyfish.js';
import { generateStructuredResponse, rewriteQuestion } from './llm.js';

const services = { searchTinyFish, fetchTinyFishUrls, rewriteQuestion, generateStructuredResponse };

export async function runResearch({ question, lang }, onProgress = () => {}, overrides = {}) {
  const startedAt = Date.now();
  const normalizedQuestion = normalizeText(question || '');
  if (!normalizedQuestion) throw new TypeError('A non-empty research question is required.');

  const detectedLang = lang || detectLanguage(normalizedQuestion);
  const dependencies = { ...services, ...overrides };
  const controller = new AbortController();
  const deadline = setTimeout(
    () => controller.abort(Object.assign(new Error('Research deadline exceeded.'), { code: 'research_timeout' })),
    env.researchTimeoutMs,
  );
  const timings = {};
  const warnings = [];
  let stage = 'received';
  let selected = [];
  let fetched = [];
  let searchQuery = '';

  const emit = (type, payload = {}) => {
    onProgress({ type, payload });
  };
  const runStage = async (name, operation) => {
    stage = name;
    emit(name, { elapsedMs: Date.now() - startedAt });
    const stepStartedAt = Date.now();
    try {
      const result = await raceWithAbort(() => operation(controller.signal), controller.signal);
      timings[`${name}Ms`] = Date.now() - stepStartedAt;
      return result;
    } catch (error) {
      timings[`${name}Ms`] = Date.now() - stepStartedAt;
      throw error;
    }
  };

  try {
    emit('received', { detectedLang });
    const rewritten = await runStage('rewriting', (signal) => dependencies.rewriteQuestion(
      normalizedQuestion,
      detectedLang,
      { signal },
    ));
    const queries = [...new Set((rewritten?.queries || []).map((query) => String(query).trim()).filter(Boolean))]
      .slice(0, 2);
    if (!queries.length) throw researchError('No usable search query was generated.', 'research_no_query');
    searchQuery = queries[0];

    const searchResults = await runStage('searching', async (signal) => {
      const settled = await Promise.allSettled(queries.map((query) => dependencies.searchTinyFish(query, {
        purpose: normalizedQuestion,
        language: detectedLang,
        signal,
      })));
      const successes = settled.filter((result) => result.status === 'fulfilled');
      if (!successes.length) throw settled[0].reason;
      if (successes.length !== settled.length) {
        warnings.push(`${settled.length - successes.length} search query failed.`);
        emit('search_warning', { failedCount: settled.length - successes.length });
      }
      return successes.flatMap((result) => result.value);
    });
    selected = rankAndDedupe(searchResults).slice(0, 5);
    emit('search_complete', { resultCount: selected.length });
    if (!selected.length) throw researchError('No usable web results were found.', 'research_no_results');

    const fetchResponse = await runStage('fetching', (signal) => dependencies.fetchTinyFishUrls(
      selected.map((result) => result.url),
      { purpose: normalizedQuestion, signal },
    ));
    fetched = fetchResponse.results;
    if (fetchResponse.errors.length) {
      warnings.push(`${fetchResponse.errors.length} source page${fetchResponse.errors.length === 1 ? '' : 's'} could not be fetched.`);
      emit('fetch_warning', { failedCount: fetchResponse.errors.length });
    }
    fetched = fetched.filter((source) => source?.url && source?.text?.trim());
    if (!fetched.length) throw researchError('No search result pages could be fetched.', 'research_no_sources');
    emit('fetch_complete', { sourceCount: fetched.length });

    const synthesis = await runStage('synthesizing', (signal) => dependencies.generateStructuredResponse({
      question: normalizedQuestion,
      language: detectedLang,
      sources: fetched.map((source) => ({
        ...source,
        text: source.text.slice(0, 6_000),
      })),
    }, { signal }));

    const usedSourceUrls = [...new Set((synthesis.usedSourceUrls || [])
      .filter((url) => fetched.some((source) => source.url === url)))].slice(0, 2);
    if (!usedSourceUrls.length) {
      throw researchError('The answer did not cite any fetched source.', 'research_no_citations');
    }

    const sources = makePublicSources(selected, fetched);
    const citationSources = usedSourceUrls.map((url) => sources.find((source) => source.url === url)).filter(Boolean);
    const reply = formatReply(synthesis.answer, usedSourceUrls);
    timings.totalMs = Date.now() - startedAt;
    const result = {
      question: normalizedQuestion,
      detectedLang,
      searchQuery,
      sources,
      extracted: fetched.map(({ url, title, text, publishedDate }) => ({
        url,
        title,
        text: text.slice(0, 1_200),
        publishedDate,
      })),
      answer: synthesis.answer,
      answerSegments: reply.segments,
      confidence: synthesis.confidence,
      needsMoreInfo: synthesis.needsMoreInfo,
      usedSourceUrls,
      citations: citationSources,
      warnings,
      status: 'completed',
      timings,
    };
    emit('completed', { elapsedMs: timings.totalMs, sourceCount: citationSources.length });
    return result;
  } catch (error) {
    timings.totalMs = Date.now() - startedAt;
    const code = error?.code || (controller.signal.aborted ? 'research_timeout' : 'research_failed');
    const safeUrls = fetched.map((source) => source?.url).filter(Boolean).slice(0, 2);
    const sources = makePublicSources(selected, fetched);
    const answer = detectedLang === 'hi'
      ? safeUrls.length
        ? 'स्रोत मिले, लेकिन सुरक्षित उत्तर सत्यापित नहीं हो सका। कृपया इन पृष्ठों को देखें:'
        : code === 'research_no_results' || code === 'research_no_sources'
          ? 'विश्वसनीय स्रोत नहीं मिले। कृपया प्रश्न को दूसरे तरीके से पूछें।'
          : 'शोध सेवा अभी उपलब्ध नहीं है। कृपया बाद में फिर कोशिश करें।'
      : safeUrls.length
        ? 'I found sources but could not safely verify an answer. Please check these pages:'
        : code === 'research_no_results' || code === 'research_no_sources'
          ? 'I could not find reliable source pages to answer this. Please try rephrasing your question.'
          : 'Research is temporarily unavailable. Please try again later.';
    const reply = formatReply(answer, safeUrls);
    emit('failed', { code, stage, elapsedMs: timings.totalMs });
    return {
      question: normalizedQuestion,
      detectedLang,
      searchQuery,
      sources,
      extracted: fetched.map(({ url, title, text, publishedDate }) => ({
        url,
        title,
        text: text.slice(0, 1_200),
        publishedDate,
      })),
      answer,
      answerSegments: reply.segments,
      confidence: 'low',
      needsMoreInfo: true,
      usedSourceUrls: [],
      citations: [],
      warnings,
      status: 'fallback',
      errorCode: code,
      timings,
    };
  } finally {
    clearTimeout(deadline);
  }
}

function raceWithAbort(operation, signal) {
  if (signal.aborted) return Promise.reject(signal.reason || new Error('Research aborted.'));
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    const onAbort = () => {
      cleanup();
      reject(signal.reason || new Error('Research aborted.'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve().then(operation).then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function rankAndDedupe(results) {
  const seen = new Set();
  return results
    .filter((result) => result && typeof result.url === 'string' && typeof result.title === 'string'
      && isHttpUrl(result.url))
    .sort((left, right) => officialScore(right.url) - officialScore(left.url)
      || (left.position || Number.MAX_SAFE_INTEGER) - (right.position || Number.MAX_SAFE_INTEGER))
    .filter((result) => {
      try {
        const url = new URL(result.url);
        if (!['http:', 'https:'].includes(url.protocol)) return false;
        const key = url.toString();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      } catch {
        return false;
      }
    });
}

function officialScore(value) {
  const host = new URL(value).hostname.toLowerCase();
  return /(^|\.)gov(\.[a-z]{2})?$/.test(host)
    || /(^|\.)gov\.[a-z]{2,}$/.test(host)
    || /(^|\.)edu(\.[a-z]{2})?$/.test(host)
    || /(^|\.)ac\.[a-z]{2,}$/.test(host)
    ? 1
    : 0;
}

function makePublicSources(searchResults, fetchedSources) {
  const fetchedByUrl = new Map(fetchedSources.map((source) => [source.url, source]));
  return searchResults.map((result) => {
    const page = fetchedByUrl.get(result.url);
    return {
      title: page?.title || result.title,
      url: result.url,
      finalUrl: page?.finalUrl || result.url,
      snippet: (page?.description || result.snippet || page?.text || '').slice(0, 400),
      publishedDate: page?.publishedDate || result.date || null,
    };
  });
}

function isHttpUrl(value) {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function formatReply(answer, urls) {
  let text = String(answer || '').trim();
  let candidates = [...urls].slice(0, 2);
  while (true) {
    try {
      return formatSmsReply(text, candidates, env.maxSmsSegments);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      if (candidates.length) {
        candidates = candidates.slice(0, -1);
      } else if (text.length > 250) {
        text = `${text.slice(0, 247).trimEnd()}...`;
      } else {
        throw error;
      }
    }
  }
}

function researchError(message, code) {
  return Object.assign(new Error(message), { code });
}

export async function queueResearchReply({ question, phone, lang }) {
  const runId = uuid();
  const run = await runResearch({ question, lang });
  await addResearchRun(runId, { runId, ...run, phone });
  return { runId, ...run };
}

export async function getStoredRun(runId) {
  return getResearchRun(runId);
}

export async function sendReplyBySms({ to, answer, urls = [] }) {
  const payload = formatSmsReply(answer, urls, env.maxSmsSegments);
  const result = await sendSms({ to, body: payload.body, segments: payload.segments });
  return { ...result, segments: payload.segments };
}

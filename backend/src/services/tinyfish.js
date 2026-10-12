import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function normalizeSearchArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

function normalizeFetchArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

async function runTinyFish(args) {
  if (process.env.TINYFISH_MODE === 'mock') {
    return { mock: true };
  }

  const hasCli = await isTinyFishInstalled();
  if (!hasCli) {
    return { mock: true };
  }

  try {
    const { stdout } = await execFileAsync('tinyfish', args, {
      env: { ...process.env },
      maxBuffer: 1024 * 1024 * 4,
    });
    return safeJsonParse(stdout);
  } catch (error) {
    return { mock: true, error: String(error.message || error) };
  }
}

async function isTinyFishInstalled() {
  try {
    await execFileAsync('tinyfish', ['--help'], { env: process.env });
    return true;
  } catch (error) {
    return false;
  }
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch (error) {
    return { raw: value };
  }
}

export async function searchTinyFish(query) {
  const raw = await runTinyFish(['search', 'query', String(query || '').trim(), '--pretty']);
  if (raw.mock) {
    return [
      {
        title: 'Official information for the requested topic',
        url: 'https://www.gov.in/',
        snippet: 'Example official public information source from a government domain.',
      },
      {
        title: 'Institutional guidance and forms',
        url: 'https://www.nic.in/',
        snippet: 'Related official institutional guidance and documentation.',
      },
      {
        title: 'Program and policy overview',
        url: 'https://www.education.gov.in/',
        snippet: 'Policy overview and related advisory information from an official education authority.',
      },
    ];
  }

  const data = normalizeSearchArray(raw);
  if (data.length) {
    return data.map((item) => ({
      title: item.title || item.name || 'Search result',
      url: item.url || item.link || item.href || '',
      snippet: item.snippet || item.description || item.content || '',
    }));
  }

  return [];
}

export async function fetchTinyFishUrls(urls = []) {
  const safeUrls = Array.from(new Set((urls || []).filter(Boolean))).slice(0, 5);
  if (!safeUrls.length) return [];

  const raw = await runTinyFish(['fetch', 'content', 'get', '--format', 'json', ...safeUrls]);
  if (raw.mock) {
    return safeUrls.map((url, index) => ({
      url,
      final_url: url,
      title: `Resource ${index + 1}`,
      text: 'This is a mock TinyFish fetch result used while the live integration is not configured.',
    }));
  }

  const data = normalizeFetchArray(raw);
  if (data.length) {
    return data.map((item) => ({
      url: item.url || item.final_url || item.href || '',
      final_url: item.final_url || item.url || '',
      title: item.title || item.name || 'Web page',
      text: item.text || item.content || item.snippet || '',
      published_date: item.published_date || '',
    }));
  }

  return [];
}

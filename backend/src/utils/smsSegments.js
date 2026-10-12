const GSM7_BASIC = new Set(
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\u001bÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà',
);
const GSM7_EXTENSION = new Set('\f^{}\\[~]|€');

export function getSmsEncoding(message = '') {
  for (const char of String(message)) {
    if (!GSM7_BASIC.has(char) && !GSM7_EXTENSION.has(char)) return 'UCS-2';
  }
  return 'GSM-7';
}

export function getSmsUnits(message = '') {
  const text = String(message);
  return getSmsEncoding(text) === 'GSM-7'
    ? [...text].reduce((total, char) => total + (GSM7_EXTENSION.has(char) ? 2 : 1), 0)
    : text.length;
}

export function countSmsSegments(message = '') {
  const encoding = getSmsEncoding(message);
  const units = getSmsUnits(message);
  const singleLimit = encoding === 'GSM-7' ? 160 : 70;
  const multipartLimit = encoding === 'GSM-7' ? 153 : 67;
  const limit = units <= singleLimit ? singleLimit : multipartLimit;
  let segments = 1;
  let currentUnits = 0;
  for (const char of String(message)) {
    const charUnits = encoding === 'GSM-7' && GSM7_EXTENSION.has(char)
      ? 2
      : (encoding === 'GSM-7' ? 1 : char.length);
    if (currentUnits + charUnits > limit) {
      segments += 1;
      currentUnits = 0;
    }
    currentUnits += charUnits;
  }
  return segments;
}

export function splitSmsMessage(message = '', maxSegments = 3) {
  const text = String(message || '').trim();
  if (!Number.isInteger(maxSegments) || maxSegments < 1) {
    throw new RangeError('maxSegments must be a positive integer');
  }
  if (!text) return [];

  const encoding = getSmsEncoding(text);
  const singleLimit = encoding === 'GSM-7' ? 160 : 70;
  const multipartLimit = encoding === 'GSM-7' ? 153 : 67;
  const limit = getSmsUnits(text) <= singleLimit ? singleLimit : multipartLimit;
  const chunks = [];
  let chunk = '';
  let units = 0;

  for (const char of text) {
    const charUnits = encoding === 'GSM-7' && GSM7_EXTENSION.has(char)
      ? 2
      : (encoding === 'GSM-7' ? 1 : char.length);
    if (units + charUnits > limit && chunk) {
      const boundary = chunk.lastIndexOf(' ');
      if (boundary > 0) {
        chunks.push(chunk.slice(0, boundary + 1));
        chunk = chunk.slice(boundary + 1);
        units = countUnits(chunk, encoding);
      } else {
        chunks.push(chunk);
        chunk = '';
        units = 0;
      }
    }

    chunk += char;
    units += charUnits;
  }
  if (chunk) chunks.push(chunk);

  if (chunks.length > maxSegments) {
    throw new RangeError(`Message requires ${chunks.length} SMS segments; maximum is ${maxSegments}`);
  }
  return chunks;
}

function countUnits(value, encoding) {
  return [...value].reduce((total, char) => total + (
    encoding === 'GSM-7'
      ? (GSM7_EXTENSION.has(char) ? 2 : 1)
      : char.length
  ), 0);
}

export function formatSmsReply(answer = '', urls = [], maxSegments = 3) {
  const safeAnswer = String(answer || '').trim();
  const safeUrls = Array.isArray(urls) ? urls.filter(Boolean).slice(0, 2).map(String) : [];
  let body = safeAnswer;
  let segments = splitSmsMessage(body, maxSegments);

  for (const url of safeUrls) {
    const candidate = [body, url].filter(Boolean).join(' ');
    try {
      segments = splitSmsMessage(candidate, maxSegments);
      body = candidate;
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
    }
  }

  if (!body) {
    throw new RangeError('An SMS reply cannot be empty');
  }

  return { body, segments, count: segments.length };
}

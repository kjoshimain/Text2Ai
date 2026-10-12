const GSM7_CHARSET = /[\x20-\x7E]/;

function isGsm7Text(value = '') {
  return String(value).split('').every((char) => GSM7_CHARSET.test(char));
}

export function countSmsSegments(message = '') {
  const text = String(message || '');
  const isGsm = isGsm7Text(text);
  const singleLimit = isGsm ? 160 : 70;
  const partLimit = isGsm ? 153 : 67;
  if (text.length <= singleLimit) return 1;
  return Math.ceil((text.length - singleLimit) / partLimit) + 1;
}

export function formatSmsReply(answer = '', urls = [], maxSegments = 3) {
  const safeAnswer = String(answer || '').trim();
  const safeUrls = Array.isArray(urls) ? urls.filter(Boolean).slice(0, 2) : [];
  const numberedUrls = safeUrls.map((url, idx) => {
    const prefix = safeUrls.length > 1 ? `${idx + 1}. ` : '';
    return `${prefix}${url}`;
  });

  const payloadParts = [safeAnswer, ...numberedUrls];
  const body = payloadParts.filter(Boolean).join(' ');
  const segments = countSmsSegments(body);

  if (segments <= maxSegments) {
    return {
      body,
      segments,
      count: segments,
    };
  }

  const trimmedAnswer = trimToSegmentLimit(safeAnswer, maxSegments);
  const remaining = maxSegments - countSmsSegments(trimmedAnswer);
  const extraUrls = numberedUrls.slice(0, Math.max(0, remaining));

  return {
    body: [trimmedAnswer, ...extraUrls].filter(Boolean).join(' '),
    segments: Math.min(maxSegments, countSmsSegments([trimmedAnswer, ...extraUrls].join(' '))),
    count: Math.min(maxSegments, countSmsSegments([trimmedAnswer, ...extraUrls].join(' '))),
  };
}

function trimToSegmentLimit(value, maxSegments) {
  const clean = String(value || '').trim();
  let index = clean.length;
  let currentSegmentCount = 1;
  while (index > 0 && currentSegmentCount < maxSegments) {
    const chunk = clean.slice(0, index);
    currentSegmentCount = countSmsSegments(chunk);
    if (currentSegmentCount <= maxSegments) {
      return chunk;
    }
    index = Math.max(0, index - 10);
  }
  return clean.slice(0, 80).trim();
}

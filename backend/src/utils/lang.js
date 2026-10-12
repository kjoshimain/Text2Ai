export function normalizeText(value = '') {
  return String(value)
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function detectLanguage(text = '') {
  if (/[\u0900-\u097F]/.test(text)) {
    return 'hi';
  }
  return 'en';
}

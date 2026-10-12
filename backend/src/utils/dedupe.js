import crypto from 'node:crypto';
import { normalizePhone } from './phone.js';

export function createDedupeKey({ smsId, phone, body }) {
  if (smsId && String(smsId).trim()) return `sms:${String(smsId).trim()}`;
  const normalized = `${normalizePhone(phone)}\n${String(body || '').trim()}`;
  return `fallback:${crypto.createHash('sha256').update(normalized).digest('hex')}`;
}

export class DedupeWindow {
  #entries = new Map();

  constructor({ windowMs = 120_000, now = Date.now } = {}) {
    this.windowMs = windowMs;
    this.now = now;
  }

  hasSeen(key) {
    this.#prune();
    const expiresAt = this.#entries.get(key);
    return expiresAt !== undefined && expiresAt > this.now();
  }

  remember(key) {
    this.#prune();
    this.#entries.set(key, this.now() + this.windowMs);
  }

  checkAndRemember(key) {
    if (this.hasSeen(key)) return false;
    this.remember(key);
    return true;
  }

  #prune() {
    const now = this.now();
    for (const [key, expiresAt] of this.#entries) {
      if (expiresAt <= now) this.#entries.delete(key);
    }
  }
}

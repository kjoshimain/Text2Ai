import crypto from 'node:crypto';
import { env } from '../config/env.js';

export function normalizePhone(phone = '') {
  const input = String(phone).trim();
  let digits = input.replace(/\D/g, '');
  if (!digits || digits.length < 8 || digits.length > 15) {
    const error = new TypeError('Phone number must contain 8 to 15 digits');
    error.status = 400;
    throw error;
  }
  if (input.startsWith('+')) return `+${digits}`;
  if (digits.length === 10) digits = `${env.defaultCountryCode}${digits}`;
  else if (digits.length === 11 && digits.startsWith('0')) digits = `${env.defaultCountryCode}${digits.slice(1)}`;
  return `+${digits}`;
}

export function maskPhone(phone = '') {
  const input = String(phone).trim();
  const digits = input.replace(/\D/g, '');
  if (!digits) return 'unknown';
  if (digits.length <= 4) return `***${digits.slice(-2)}`;
  if (input.startsWith('+') && digits.length > 10) {
    const countryPrefix = digits.slice(0, digits.length - 10);
    return `+${countryPrefix}*****${digits.slice(-4)}`;
  }
  return `*****${digits.slice(-4)}`;
}

export function hashPhone(phone = '') {
  const normalized = normalizePhone(phone);
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

import crypto from 'node:crypto';

export function maskPhone(phone = '') {
  const digits = String(phone).replace(/\D/g, '');
  if (!digits) return 'unknown';
  if (digits.length <= 4) return `***${digits.slice(-2)}`;
  if (digits.length <= 8) return `${digits.slice(0, 2)}*****${digits.slice(-2)}`;
  return `+${digits.slice(0, 2)}*****${digits.slice(-4)}`;
}

export function hashPhone(phone = '') {
  return crypto.createHash('sha256').update(String(phone).trim()).digest('hex');
}

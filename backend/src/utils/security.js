import crypto from 'node:crypto';

export function hmacSha256(secret, body) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

export function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function verifyHmac(secret, rawBody, signature) {
  if (!secret || !signature) return false;
  const supplied = String(signature).replace(/^sha256=/i, '');
  return safeEqual(hmacSha256(secret, rawBody), supplied);
}

export function hashSecret(secret) {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

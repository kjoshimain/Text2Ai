import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const configDirectory = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(configDirectory, '../../.env') });
dotenv.config({ path: path.resolve(configDirectory, '../../../.env') });

const isTestEnvironment = String(process.env.NODE_ENV || '').toLowerCase() === 'test'
  || process.execArgv.some((arg) => arg.includes('--test'))
  || process.argv.some((arg) => arg.includes('--test'));
const requestedOutboxLongPollMs = Number(process.env.OUTBOX_LONG_POLL_MS || 3000);
const maxOutboxLongPollMs = 4000;
if (!Number.isInteger(requestedOutboxLongPollMs) || requestedOutboxLongPollMs < 1) {
  throw new Error('OUTBOX_LONG_POLL_MS must be a positive integer');
}
if (requestedOutboxLongPollMs > maxOutboxLongPollMs) {
  console.warn(`OUTBOX_LONG_POLL_MS exceeds ${maxOutboxLongPollMs}ms; limiting it to protect serverless requests.`);
}

export const env = {
  port: Number(process.env.PORT || 3001),
  nodeEnv: process.env.NODE_ENV || 'development',
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  logLevel: process.env.LOG_LEVEL || 'info',
  maxSmsSegments: Number(process.env.MAX_SMS_SEGMENTS || 3),
  researchTimeoutMs: Number(process.env.RESEARCH_TIMEOUT_MS || 40000),
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 3600000),
  rateLimitPhoneMax: Number(process.env.RATE_LIMIT_PHONE_MAX || 5),
  rateLimitIpMax: Number(process.env.RATE_LIMIT_IP_MAX || 120),
  maxInboundChars: Number(process.env.MAX_INBOUND_CHARS || 1000),
  requestBodyLimit: process.env.REQUEST_BODY_LIMIT || '32kb',
  pairingCodeTtlMs: Number(process.env.PAIRING_CODE_TTL_MS || 600000),
  gatewayPairingSecret: process.env.GATEWAY_PAIRING_SECRET || '',
  outboxLongPollMs: Math.min(requestedOutboxLongPollMs, maxOutboxLongPollMs),
  outboxExpiryMs: Number(process.env.OUTBOX_EXPIRY_MS || 600000),
  retentionDays: Number(process.env.RETENTION_DAYS || 30),
  defaultCountryCode: process.env.DEFAULT_COUNTRY_CODE || '91',
  tinyfishApiKey: isTestEnvironment ? '' : (process.env.TINYFISH_API_KEY || ''),
  tinyfishTimeoutMs: Number(process.env.TINYFISH_TIMEOUT_MS || 20000),
  tinyfishRetries: Number(process.env.TINYFISH_RETRIES || 2),
  llmProvider: isTestEnvironment ? 'mock' : (process.env.LLM_PROVIDER || 'mock'),
  llmApiKey: isTestEnvironment ? '' : (process.env.LLM_API_KEY || ''),
  llmModel: process.env.LLM_MODEL || 'claude-sonnet-4-20250514',
  llmTimeoutMs: Number(process.env.LLM_TIMEOUT_MS || 15000),
  llmRetries: Number(process.env.LLM_RETRIES || 1),
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseKey: process.env.SUPABASE_KEY || '',
};

for (const [name, value] of Object.entries({
  PORT: env.port,
  MAX_SMS_SEGMENTS: env.maxSmsSegments,
  RESEARCH_TIMEOUT_MS: env.researchTimeoutMs,
  TINYFISH_TIMEOUT_MS: env.tinyfishTimeoutMs,
  LLM_TIMEOUT_MS: env.llmTimeoutMs,
  RATE_LIMIT_WINDOW_MS: env.rateLimitWindowMs,
  RATE_LIMIT_PHONE_MAX: env.rateLimitPhoneMax,
  RATE_LIMIT_IP_MAX: env.rateLimitIpMax,
  MAX_INBOUND_CHARS: env.maxInboundChars,
  PAIRING_CODE_TTL_MS: env.pairingCodeTtlMs,
  OUTBOX_LONG_POLL_MS: env.outboxLongPollMs,
  OUTBOX_EXPIRY_MS: env.outboxExpiryMs,
  RETENTION_DAYS: env.retentionDays,
})) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}
for (const [name, value] of Object.entries({
  TINYFISH_RETRIES: env.tinyfishRetries,
  LLM_RETRIES: env.llmRetries,
})) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}
if (env.port > 65_535) throw new Error('PORT must not exceed 65535');
if (env.gatewayPairingSecret && Buffer.byteLength(env.gatewayPairingSecret, 'utf8') < 32) {
  throw new Error('GATEWAY_PAIRING_SECRET must be at least 32 bytes when configured');
}
if (env.nodeEnv === 'production' && !env.gatewayPairingSecret) {
  throw new Error('GATEWAY_PAIRING_SECRET is required in production');
}
if (!/^\d{1,3}$/.test(env.defaultCountryCode)) {
  throw new Error('DEFAULT_COUNTRY_CODE must contain 1 to 3 digits');
}

export function isConfigured(name) {
  return Boolean(process.env[name]);
}

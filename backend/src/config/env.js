import dotenv from 'dotenv';

dotenv.config();

export const env = {
  port: Number(process.env.PORT || 3001),
  nodeEnv: process.env.NODE_ENV || 'development',
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  logLevel: process.env.LOG_LEVEL || 'info',
  maxSmsSegments: Number(process.env.MAX_SMS_SEGMENTS || 3),
  researchTimeoutMs: Number(process.env.RESEARCH_TIMEOUT_MS || 40000),
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 3600000),
  rateLimitMaxRequests: Number(process.env.RATE_LIMIT_MAX_REQUESTS || 5),
  tinyfishMode: process.env.TINYFISH_MODE || 'mock',
  llmProvider: process.env.LLM_PROVIDER || 'mock',
  llmModel: process.env.LLM_MODEL || 'claude-sonnet-4-20250514',
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseKey: process.env.SUPABASE_KEY || '',
};

export function isConfigured(name) {
  return Boolean(process.env[name]);
}

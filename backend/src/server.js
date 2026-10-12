import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pino from 'pino';
import { env } from './config/env.js';
import researchRoutes from './routes/research.js';
import conversationRoutes from './routes/conversations.js';
import gatewayRoutes from './routes/gateway.js';

const logger = pino({ level: env.logLevel });
const app = express();

app.use(helmet());
app.use(cors({ origin: env.clientOrigin.split(',') }));
app.use(express.json({ limit: '1mb' }));

const windowMs = env.rateLimitWindowMs;
const maxRequests = env.rateLimitMaxRequests;
const requestTracker = new Map();

app.use((req, res, next) => {
  const key = req.ip || 'unknown';
  const now = Date.now();
  const bucket = requestTracker.get(key) || { count: 0, start: now };

  if (now - bucket.start > windowMs) {
    bucket.count = 0;
    bucket.start = now;
  }

  if (bucket.count >= maxRequests) {
    return res.status(429).json({ error: 'Rate limit exceeded. Please try again later.' });
  }

  bucket.count += 1;
  requestTracker.set(key, bucket);
  next();
});

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    integrations: {
      tinyFish: env.tinyfishMode !== 'mock',
      llm: env.llmProvider !== 'mock',
      supabase: Boolean(env.supabaseUrl),
      twilio: Boolean(process.env.TWILIO_ACCOUNT_SID),
    },
  });
});

app.use('/api/research', researchRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/gateway', gatewayRoutes);

app.use((err, req, res, next) => {
  logger.error({ err }, 'Unhandled server error');
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(env.port, () => {
  logger.info(`Text2AI backend listening on http://localhost:${env.port}`);
});

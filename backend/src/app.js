import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pino from 'pino';
import { env } from './config/env.js';
import { activeStore } from './services/store/index.js';
import { cleanupExpiredData } from './services/store/index.js';
import researchRoutes, { simulatorRouter } from './routes/research.js';
import conversationRoutes from './routes/conversations.js';
import gatewayRoutes from './routes/gateway.js';
import { FixedWindowRateLimiter } from './utils/rateLimit.js';

export function createApp({ logger = pino({ level: env.logLevel }) } = {}) {
  const app = express();
  const allowedOrigins = env.clientOrigin.split(',').map((origin) => origin.trim()).filter(Boolean);
  const ipLimiter = new FixedWindowRateLimiter({
    limit: env.rateLimitIpMax,
    windowMs: env.rateLimitWindowMs,
  });

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: allowedOrigins }));
  app.use((req, res, next) => {
    const requestId = String(req.get('x-request-id') || crypto.randomUUID()).slice(0, 100);
    req.id = requestId;
    req.log = logger.child({ requestId });
    res.setHeader('X-Request-Id', requestId);
    const startedAt = Date.now();
    res.on('finish', () => {
      req.log.info({
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
      }, 'request completed');
    });
    next();
  });
  app.use(express.json({
    limit: env.requestBodyLimit,
    verify: (req, res, buffer) => {
      req.rawBody = buffer.toString('utf8');
    },
  }));
  app.use(express.urlencoded({
    extended: false,
    limit: env.requestBodyLimit,
    verify: (req, res, buffer) => {
      req.rawBody = buffer.toString('utf8');
    },
  }));

  app.use('/api', (req, res, next) => {
    if (req.path === '/health') return next();
    const result = ipLimiter.consume(req.ip || 'unknown');
    if (!result.allowed) {
      res.setHeader('Retry-After', String(Math.ceil(result.retryAfterMs / 1000)));
      return res.status(429).json({ error: 'Rate limit exceeded. Please try again later.' });
    }
    return next();
  });

  app.get('/api/health', (req, res) => {
    res.json({
      ok: true,
      store: activeStore,
      integrations: {
        tinyFish: Boolean(env.tinyfishApiKey),
        llm: env.llmProvider === 'anthropic' && Boolean(env.llmApiKey),
        gatewayAdmin: Boolean(env.gatewayPairingSecret),
        supabase: activeStore === 'supabase',
        twilio: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
      },
    });
  });

  app.use('/api/research', researchRoutes);
  app.use('/api', simulatorRouter);
  app.use('/api/conversations', conversationRoutes);
  app.use('/api/gateway', gatewayRoutes);

  app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.status || error.statusCode || 500;
    req.log.error({
      errorName: error.name,
      errorCode: error.code,
      statusCode: status,
    }, 'Request failed');
    if (status === 400 && error.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Malformed JSON request body' });
    }
    if (status === 413) {
      return res.status(413).json({ error: 'Request body exceeds the configured size limit' });
    }
    return res.status(status >= 400 && status < 500 ? status : 500).json({
      error: status >= 500 ? 'Internal server error' : error.message,
    });
  });

  app.locals.cleanup = async () => cleanupExpiredData({ retentionDays: env.retentionDays });
  return app;
}

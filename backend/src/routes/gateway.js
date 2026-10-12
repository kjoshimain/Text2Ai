import crypto from 'node:crypto';
import express from 'express';
import { env } from '../config/env.js';
import {
  ackOutboundMessage,
  claimInboundDedupe,
  addResearchRun,
  consumePairingCode,
  createConversation,
  createPairingCode,
  findConversationByPhoneHash,
  findDeviceByTokenHash,
  getOutbox,
  listDevices,
  queueOutboundMessage,
  registerDevice,
  revokeDevice,
  saveMessage,
  touchDevice,
  waitForOutbox,
} from '../services/store/index.js';
import { runResearch } from '../services/research.js';
import { detectLanguage, normalizeText } from '../utils/lang.js';
import { createDedupeKey } from '../utils/dedupe.js';
import { hashPhone, maskPhone, normalizePhone } from '../utils/phone.js';
import { hashSecret, safeEqual, verifyHmac } from '../utils/security.js';
import { splitSmsMessage } from '../utils/smsSegments.js';
import { FixedWindowRateLimiter } from '../utils/rateLimit.js';
import { retainBackgroundTask } from '../utils/background.js';

const router = express.Router();
const phoneLimiter = new FixedWindowRateLimiter({
  limit: env.rateLimitPhoneMax,
  windowMs: env.rateLimitWindowMs,
});
const HELP_REPLY = 'Text your question in English or Hindi to get a short, source-backed answer. Reply HELP for these instructions.';
const RATE_LIMIT_REPLY = 'You have reached the question limit for this hour. Please try again later.';

function readBearerToken(req) {
  const authorization = req.get('authorization') || '';
  if (/^Bearer\s+/i.test(authorization)) return authorization.replace(/^Bearer\s+/i, '').trim();
  return req.get('x-device-token') || '';
}

async function authenticateGateway(req, res, next) {
  try {
    const token = readBearerToken(req);
    if (!token) return res.status(401).json({ error: 'Device token required' });
    const device = await findDeviceByTokenHash(hashSecret(token));
    if (!device || device.revoked) return res.status(401).json({ error: 'Invalid or revoked device token' });
    if (!verifyHmac(token, req.rawBody || '', req.get('x-device-signature'))) {
      return res.status(401).json({ error: 'Invalid request signature' });
    }
    req.gatewayDevice = device;
    await touchDevice(device.device_id || device.deviceId);
    return next();
  } catch (error) {
    return next(error);
  }
}

function authenticateGatewayAdmin(req, res, next) {
  if (!env.gatewayPairingSecret) {
    return res.status(503).json({ error: 'Gateway administration is not configured' });
  }
  if (!safeEqual(req.get('x-gateway-admin-key'), env.gatewayPairingSecret)) {
    return res.status(401).json({ error: 'Gateway administrator authentication required' });
  }
  return next();
}

async function getOrCreateConversation(phoneHash, phoneMasked) {
  const existing = await findConversationByPhoneHash(phoneHash);
  return existing || createConversation({ phoneHash, phoneMasked });
}

async function enqueueReply({ deviceId, to, body, conversationId }) {
  const segments = splitSmsMessage(body, env.maxSmsSegments);
  const item = {
    id: crypto.randomUUID(),
    to,
    body: segments.join(''),
    segments,
    status: 'queued',
    createdAt: Date.now(),
    expiresAt: Date.now() + env.outboxExpiryMs,
    conversationId,
  };
  await queueOutboundMessage(deviceId, item);
  await saveMessage({
    conversationId,
    direction: 'outbound',
    body: item.body,
    providerMessageId: item.id,
    status: 'queued',
    segments: segments.length,
  });
  return item;
}

router.post('/pair', async (req, res, next) => {
  try {
    const deviceId = String(req.body?.deviceId || '').trim();
    const pairingCode = String(req.body?.pairingCode || '').trim().toUpperCase();
    if (!deviceId || deviceId.length > 100 || !pairingCode) {
      return res.status(400).json({ error: 'deviceId and pairingCode are required' });
    }
    if (!(await consumePairingCode(pairingCode))) {
      return res.status(400).json({ error: 'Pairing code is invalid or expired' });
    }
    const token = crypto.randomBytes(32).toString('base64url');
    await registerDevice(deviceId, { token_hash: hashSecret(token), paired_at: new Date().toISOString() });
    return res.status(201).json({ ok: true, deviceId, token });
  } catch (error) {
    return next(error);
  }
});

router.post('/pairing-code', authenticateGatewayAdmin, async (req, res, next) => {
  try {
    const code = crypto.randomInt(0, 36 ** 6).toString(36).padStart(6, '0').toUpperCase();
    const expiresAt = Date.now() + env.pairingCodeTtlMs;
    await createPairingCode(code, { expiresAt });
    return res.status(201).json({ code, expiresAt });
  } catch (error) {
    return next(error);
  }
});

router.get('/devices', authenticateGatewayAdmin, async (req, res, next) => {
  try {
    const devices = await listDevices();
    const result = await Promise.all(devices.map(async (device) => ({
        deviceId: device.device_id || device.deviceId,
        lastSeen: device.last_seen || null,
        revoked: Boolean(device.revoked),
        queueLength: device.queue_length ?? (await getOutbox(device.device_id || device.deviceId)).length,
      })));
    return res.json({ devices: result });
  } catch (error) {
    return next(error);
  }
});

router.post('/devices/:deviceId/revoke', authenticateGatewayAdmin, async (req, res, next) => {
  try {
    const device = await revokeDevice(req.params.deviceId);
    if (!device) return res.status(404).json({ error: 'Device not found' });
    return res.json({ ok: true, deviceId: req.params.deviceId, revoked: true });
  } catch (error) {
    return next(error);
  }
});

router.post('/inbound', authenticateGateway, async (req, res, next) => {
  const deviceId = req.gatewayDevice.device_id || req.gatewayDevice.deviceId;
  try {
    const from = normalizePhone(req.body?.from);
    const body = normalizeText(req.body?.body || '');
    const smsId = String(req.body?.smsId || '').slice(0, 200);
    if (!body) return res.status(400).json({ error: 'SMS body must not be empty' });
    if (body.length > env.maxInboundChars) {
      return res.status(413).json({ error: `SMS body exceeds ${env.maxInboundChars} characters` });
    }
    const dedupeKey = createDedupeKey({ smsId, phone: from, body });
    const dedupeTtlMs = smsId ? env.retentionDays * 24 * 60 * 60_000 : 120_000;
    if (!(await claimInboundDedupe(dedupeKey, { expiresAt: Date.now() + dedupeTtlMs }))) {
      return res.status(200).json({ ok: true, duplicate: true });
    }

    const phoneHash = hashPhone(from);
    const phoneMasked = maskPhone(from);
    const conversation = await getOrCreateConversation(phoneHash, phoneMasked);
    await saveMessage({
      conversationId: conversation.id,
      direction: 'inbound',
      body,
      providerMessageId: smsId || undefined,
      status: 'received',
    });

    let limited = false;
    if (body.toUpperCase() !== 'HELP') {
      limited = !phoneLimiter.consume(phoneHash).allowed;
    }

    res.status(202).json({ ok: true, received: true, conversationId: conversation.id });
    const task = (async () => {
      let answer;
      try {
        if (body.toUpperCase() === 'HELP') answer = HELP_REPLY;
        else if (limited) answer = RATE_LIMIT_REPLY;
        else {
          const result = await runResearch({ question: body, phone: from, lang: detectLanguage(body) });
          answer = result.answerSegments.join('');
        }
      } catch (error) {
        req.log.error({
          errorName: error.name,
          errorCode: error.code,
          deviceId,
          phone: phoneMasked,
        }, 'Inbound SMS processing failed');
        answer = 'Sorry, we could not process your question right now. Please try again later.';
      }
      try {
        await enqueueReply({ deviceId, to: from, body: answer, conversationId: conversation.id });
      } catch (error) {
        req.log.error({
          errorName: error.name,
          errorCode: error.code,
          deviceId,
          phone: phoneMasked,
        }, 'Inbound SMS processing failed');
      }
    })();
    retainBackgroundTask(task);
    return undefined;
  } catch (error) {
    return next(error);
  }
});

router.get('/outbox', authenticateGateway, async (req, res, next) => {
  try {
    const deviceId = req.gatewayDevice.device_id || req.gatewayDevice.deviceId;
    const items = await waitForOutbox(deviceId, env.outboxLongPollMs);
    return res.json({
      items: items.map((item) => ({
        id: item.id,
        to: item.to,
        body: item.body,
        segments: item.segments,
      })),
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/ack', authenticateGateway, async (req, res, next) => {
  try {
    const deviceId = req.gatewayDevice.device_id || req.gatewayDevice.deviceId;
    const messageId = String(req.body?.messageId || '').trim();
    const status = String(req.body?.status || '').toLowerCase();
    if (!messageId || !['sent', 'delivered', 'failed'].includes(status)) {
      return res.status(400).json({ error: 'messageId and a valid status are required' });
    }
    const updated = await ackOutboundMessage(deviceId, messageId, status);
    if (!updated) return res.status(404).json({ error: 'Queued message not found or expired' });
    return res.json({ ok: true, messageId, status });
  } catch (error) {
    return next(error);
  }
});

export default router;

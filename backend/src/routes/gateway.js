import express from 'express';
import crypto from 'node:crypto';
import { v4 as uuid } from 'uuid';
import { createConversation, listDevices, registerDevice, getDevice, queueOutboundMessage, getOutbox, saveMessage, listConversations, getConversation } from '../services/store/memory.js';
import { hashPhone, maskPhone } from '../utils/phone.js';
import { runResearch } from '../services/research.js';

const router = express.Router();
const codes = new Map();

router.post('/pair', (req, res) => {
  const { deviceId, pairingCode } = req.body || {};
  const stored = codes.get(pairingCode);
  if (!stored) return res.status(400).json({ error: 'Invalid pairing code' });

  const token = crypto.randomBytes(18).toString('hex');
  registerDevice(deviceId, { deviceId, token, paired: true, createdAt: new Date().toISOString() });
  res.json({ ok: true, deviceId, token });
});

router.post('/pairing-code', (req, res) => {
  const code = Math.random().toString(36).slice(2, 8).toUpperCase();
  const { deviceId } = req.body || {};
  codes.set(code, { deviceId, createdAt: Date.now() });
  res.json({ code, expiresAt: Date.now() + 600000 });
});

router.get('/devices', (req, res) => {
  res.json({ devices: listDevices() });
});

router.post('/inbound', async (req, res) => {
  const { deviceId, from, body, receivedAt, smsId } = req.body || {};
  const phoneHash = hashPhone(from);
  const phoneMasked = maskPhone(from);

  const existing = listConversations().find((item) => item.phone_hash === phoneHash);
  const conversation = existing || createConversation({ phoneHash, phoneMasked });

  saveMessage({ conversationId: conversation.id, direction: 'inbound', body, providerMessageId: smsId || `inbound-${Date.now()}`, status: 'received' });
  res.status(202).json({ ok: true, received: true, conversationId: conversation.id });

  const dedupeKey = smsId || `${phoneHash}:${String(body).slice(0, 60)}`;
  const recent = getConversation(conversation.id);
  if (recent && recent.last_dedupe === dedupeKey) {
    return;
  }

  const run = await runResearch({ question: body, phone: from }, () => {});
  const out = {
    id: uuid(),
    to: from,
    body: run.answer,
    segments: run.answerSegments?.length || 1,
    status: 'queued',
  };
  queueOutboundMessage(deviceId || 'gateway', out);
  getDevice(deviceId || 'gateway') && getDevice(deviceId || 'gateway');
  saveMessage({ conversationId: conversation.id, direction: 'outbound', body: run.answer, providerMessageId: out.id, status: 'queued', segments: out.segments });
});

router.get('/outbox', (req, res) => {
  const token = req.headers.authorization || req.headers['x-device-token'];
  const device = [...listDevices()].find((entry) => entry.token === token?.replace('Bearer ', ''));
  if (!device) {
    return res.status(401).json({ error: 'Device token required' });
  }
  res.json({ items: getOutbox(device.deviceId) });
});

router.post('/ack', (req, res) => {
  const { deviceId, messageId, status } = req.body || {};
  res.json({ ok: true, deviceId, messageId, status });
});

export default router;

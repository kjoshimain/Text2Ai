import express from 'express';
import { v4 as uuid } from 'uuid';
import { runResearch, getStoredRun } from '../services/research.js';
import { addResearchRun, listConversations, saveMessage, getConversation, createConversation } from '../services/store/memory.js';
import { hashPhone, maskPhone } from '../utils/phone.js';

const router = express.Router();
const runStreams = new Map();

router.post('/', async (req, res) => {
  const { question, phone, lang } = req.body || {};
  if (!question || !String(question).trim()) {
    return res.status(400).json({ error: 'question is required' });
  }

  const runId = uuid();
  const clients = new Set();
  runStreams.set(runId, clients);

  const runPromise = runResearch({ question, phone, lang }, (event) => {
    const payload = { type: event.type, ...event.payload };
    for (const client of clients) {
      client.write(`event: ${event.type}\ndata: ${JSON.stringify(payload)}\n\n`);
    }
  });

  const result = await runPromise;
  const entry = { runId, ...result };
  addResearchRun(runId, entry);
  res.json({ runId, status: 'queued', result: entry });
});

router.get('/:runId/stream', (req, res) => {
  const { runId } = req.params;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });

  const clients = runStreams.get(runId) || new Set();
  clients.add(res);
  runStreams.set(runId, clients);

  const existing = getStoredRun(runId);
  if (existing) {
    res.write(`event: final\ndata: ${JSON.stringify(existing)}\n\n`);
    res.end();
    return;
  }

  res.write(`event: connected\ndata: ${JSON.stringify({ runId })}\n\n`);
});

router.post('/simulate-sms', async (req, res) => {
  const { from, body } = req.body || {};
  const question = String(body || '').trim();
  const phoneHash = hashPhone(from);
  const phoneMasked = maskPhone(from);

  let conversation = listConversations().find((item) => item.phone_hash === phoneHash);
  if (!conversation) {
    conversation = createConversation({ phoneHash, phoneMasked });
  }

  saveMessage({
    conversationId: conversation.id,
    direction: 'inbound',
    body: question,
    providerMessageId: `sim-${Date.now()}`,
    status: 'received',
  });

  const run = await runResearch({ question, phone: from }, () => {});
  const payload = { runId: uuid(), ...run };
  addResearchRun(payload.runId, payload);
  saveMessage({
    conversationId: conversation.id,
    direction: 'outbound',
    body: run.answer,
    providerMessageId: `sim-reply-${Date.now()}`,
    status: 'queued',
    segments: run.answerSegments?.length || 1,
  });

  res.json({ ok: true, conversationId: conversation.id, run: payload });
});

export default router;

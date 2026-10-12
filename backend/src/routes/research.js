import express from 'express';
import { v4 as uuid } from 'uuid';
import { env } from '../config/env.js';
import { runResearch, getStoredRun } from '../services/research.js';
import { sendSms } from '../services/sms/index.js';
import {
  addResearchRun,
  createConversation,
  findConversationByPhoneHash,
  saveMessage,
} from '../services/store/index.js';
import { detectLanguage, normalizeText } from '../utils/lang.js';
import { hashPhone, maskPhone, normalizePhone } from '../utils/phone.js';

const router = express.Router();
export const simulatorRouter = express.Router();
const runStreams = new Map();

function publishRunEvent(runId, event, data) {
  const state = runStreams.get(runId);
  if (!state) return;
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  state.events.push(message);
  for (const client of state.clients) client.write(message);
}

router.post('/', async (req, res, next) => {
  try {
    const { question, phone, lang } = req.body || {};
    const normalizedQuestion = normalizeText(question || '');
    if (!normalizedQuestion) return res.status(400).json({ error: 'question is required' });
    if (normalizedQuestion.length > env.maxInboundChars) {
      return res.status(413).json({ error: `question exceeds ${env.maxInboundChars} characters` });
    }

    const runId = uuid();
    runStreams.set(runId, { clients: new Set(), events: [], complete: false });
    setImmediate(async () => {
      try {
        const result = await runResearch({ question: normalizedQuestion, lang }, (event) => {
          publishRunEvent(runId, event.type, event.payload);
        });
        const entry = { runId, ...result };
        await addResearchRun(runId, entry);
        publishRunEvent(runId, 'final', entry);
      } catch (error) {
        req.log.error({ errorName: error.name, errorCode: error.code }, 'Research run could not be stored');
        publishRunEvent(runId, 'run_error', {
          runId,
          status: 'failed',
          error: 'The research run could not be completed. Please try again.',
        });
      } finally {
        const state = runStreams.get(runId);
        if (state) {
          state.complete = true;
          for (const client of state.clients) client.end();
          state.clients.clear();
          const cleanupTimer = setTimeout(() => runStreams.delete(runId), 60_000);
          cleanupTimer.unref();
        }
      }
    });
    return res.status(202).json({ runId, status: 'accepted' });
  } catch (error) {
    return next(error);
  }
});

router.get('/:runId/stream', async (req, res, next) => {
  try {
    const { runId } = req.params;
    const state = runStreams.get(runId);
    if (state) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      });
      if (!state.complete) state.clients.add(res);
      res.write(`event: connected\ndata: ${JSON.stringify({ runId })}\n\n`);
      for (const event of state.events) res.write(event);
      if (state.complete) return res.end();
      res.on('close', () => state.clients.delete(res));
      return undefined;
    }

    const existing = await getStoredRun(runId);
    if (!existing) return res.status(404).json({ error: 'Research run not found' });
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    res.write(`event: final\ndata: ${JSON.stringify(existing)}\n\n`);
    return res.end();
  } catch (error) {
    return next(error);
  }
});

simulatorRouter.post('/simulate-sms', async (req, res, next) => {
  try {
    const { from, body } = req.body || {};
    const question = normalizeText(body || '');
    if (!question) return res.status(400).json({ error: 'body is required' });
    if (!from) return res.status(400).json({ error: 'from is required' });
    if (question.length > env.maxInboundChars) {
      return res.status(413).json({ error: `body exceeds ${env.maxInboundChars} characters` });
    }

    const normalizedFrom = normalizePhone(from);
    const phoneHash = hashPhone(normalizedFrom);
    const phoneMasked = maskPhone(normalizedFrom);
    const conversation = await findConversationByPhoneHash(phoneHash)
      || await createConversation({ phoneHash, phoneMasked });
    await saveMessage({
      conversationId: conversation.id,
      direction: 'inbound',
      body: question,
      providerMessageId: `sim-${uuid()}`,
      status: 'received',
    });

    const run = question.toUpperCase() === 'HELP'
      ? {
        question,
        detectedLang: detectLanguage(question),
        searchQuery: '',
        answer: 'Text your question in English or Hindi to get a short, source-backed answer. Reply HELP for these instructions.',
        answerSegments: ['Text your question in English or Hindi to get a short, source-backed answer. Reply HELP for these instructions.'],
        confidence: 'low',
        status: 'completed',
        sources: [],
        extracted: [],
        timings: {},
      }
      : await runResearch({ question, phone: normalizedFrom }, () => {});

    const payload = { runId: uuid(), ...run };
    await addResearchRun(payload.runId, payload);
    const smsBody = run.answerSegments.join('');
    const delivery = await sendSms({
      to: normalizedFrom,
      body: smsBody,
      segments: run.answerSegments,
      provider: 'mock',
    });
    await saveMessage({
      conversationId: conversation.id,
      direction: 'outbound',
      body: run.answer,
      providerMessageId: delivery.messageId,
      status: delivery.ok ? 'sent' : 'failed',
      segments: run.answerSegments.length || 1,
    });

    return res.json({
      ok: true,
      conversationId: conversation.id,
      delivery: { status: delivery.ok ? 'sent' : 'failed' },
      run: payload,
    });
  } catch (error) {
    return next(error);
  }
});

export default router;

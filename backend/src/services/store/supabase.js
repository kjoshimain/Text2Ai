import crypto from 'node:crypto';
import { assertMessageStatusTransition } from '../../utils/messageStatus.js';

function makeUrl(path, query = '') {
  const base = process.env.SUPABASE_URL?.replace(/\/+$/, '');
  if (!base) throw new Error('SUPABASE_URL is required for the Supabase store');
  return `${base}/rest/v1/${path}${query ? `?${query}` : ''}`;
}

async function request(path, { method = 'GET', query = '', body, prefer } = {}) {
  const key = process.env.SUPABASE_KEY;
  if (!key) throw new Error('SUPABASE_KEY is required for the Supabase store');
  const response = await fetch(makeUrl(path, query), {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`Supabase request failed (${response.status}): ${text.slice(0, 300)}`);
    error.status = response.status;
    throw error;
  }
  return text ? JSON.parse(text) : [];
}

export const supabaseStore = {
  async createConversation({ phoneHash, phoneMasked }) {
    const existing = await this.findConversationByPhoneHash(phoneHash);
    if (existing) return existing;
    const [row] = await request('conversations', {
      method: 'POST',
      query: 'select=*',
      body: { phone_hash: phoneHash, phone_masked: phoneMasked },
      prefer: 'return=representation',
    });
    return row;
  },
  async findConversationByPhoneHash(phoneHash) {
    const [row] = await request('conversations', {
      query: `phone_hash=eq.${encodeURIComponent(phoneHash)}&select=*&limit=1`,
    });
    return row || null;
  },
  async listConversations() {
    return request('conversations', { query: 'select=*&order=created_at.desc' });
  },
  async getConversation(id) {
    const [row] = await request('conversations', {
      query: `id=eq.${encodeURIComponent(id)}&select=*&limit=1`,
    });
    return row || null;
  },
  async saveMessage(input) {
    if (input.providerMessageId) {
      const [existing] = await request('messages', {
        query: `provider_message_id=eq.${encodeURIComponent(input.providerMessageId)}&select=*&limit=1`,
      });
      if (existing) return existing;
    }
    const [row] = await request('messages', {
      method: 'POST',
      query: 'select=*',
      body: {
        conversation_id: input.conversationId,
        direction: input.direction,
        body: input.body,
        provider_message_id: input.providerMessageId || null,
        status: input.status || 'queued',
        segments: input.segments || 1,
      },
      prefer: 'return=representation',
    });
    return row;
  },
  async updateMessageStatus(providerMessageId, status) {
    const [row] = await request('messages', {
      method: 'PATCH',
      query: `provider_message_id=eq.${encodeURIComponent(providerMessageId)}&select=*`,
      body: { status },
      prefer: 'return=representation',
    });
    return row || null;
  },
  async listMessages(conversationId) {
    return request('messages', {
      query: `conversation_id=eq.${encodeURIComponent(conversationId)}&select=*&order=created_at.asc`,
    });
  },
  async addResearchRun(runId, payload) {
    const [row] = await request('research_runs', {
      method: 'POST',
      query: 'select=*',
      body: {
        id: runId,
        conversation_id: payload.conversationId || null,
        question: payload.question || '',
        lang: payload.detectedLang || 'en',
        search_query: payload.searchQuery || '',
        sources: payload.sources || [],
        extracted: payload.extracted || [],
        answer: payload.answer || '',
        confidence: payload.confidence || 'low',
        status: payload.status || 'running',
        timings: payload.timings || {},
      },
      prefer: 'return=representation',
    });
    return row;
  },
  async getResearchRun(runId) {
    const [row] = await request('research_runs', {
      query: `id=eq.${encodeURIComponent(runId)}&select=*&limit=1`,
    });
    return row || null;
  },
  async createPairingCode(code, { expiresAt }) {
    await request('pairing_codes', {
      method: 'POST',
      body: { code, expires_at: new Date(expiresAt).toISOString() },
      prefer: 'return=minimal',
    });
  },
  async consumePairingCode(code) {
    return request('rpc/consume_pairing_code', {
      method: 'POST',
      body: { input_code: code },
    });
  },
  async claimInboundDedupe(key, { expiresAt }) {
    const dedupeHash = crypto.createHash('sha256').update(key).digest('hex');
    await request('inbound_dedupe', {
      method: 'DELETE',
      query: `dedupe_hash=eq.${dedupeHash}&expires_at=lte.${encodeURIComponent(new Date().toISOString())}`,
      prefer: 'return=minimal',
    });
    try {
      await request('inbound_dedupe', {
        method: 'POST',
        body: { dedupe_hash: dedupeHash, expires_at: new Date(expiresAt).toISOString() },
        prefer: 'return=minimal',
      });
      return true;
    } catch (error) {
      if (error.status === 409) return false;
      throw error;
    }
  },
  async registerDevice(deviceId, data) {
    const [row] = await request('devices', {
      method: 'POST',
      query: 'on_conflict=device_id&select=*',
      body: {
        device_id: deviceId,
        token_hash: data.token_hash,
        last_seen: new Date().toISOString(),
        revoked: false,
      },
      prefer: 'resolution=merge-duplicates,return=representation',
    });
    return row;
  },
  async getDevice(deviceId) {
    const [row] = await request('devices', {
      query: `device_id=eq.${encodeURIComponent(deviceId)}&select=*&limit=1`,
    });
    return row || null;
  },
  async findDeviceByTokenHash(tokenHash) {
    const [row] = await request('devices', {
      query: `token_hash=eq.${encodeURIComponent(tokenHash)}&revoked=eq.false&select=*&limit=1`,
    });
    return row || null;
  },
  async listDevices() {
    return request('devices', { query: 'select=*&order=last_seen.desc' });
  },
  async touchDevice(deviceId) {
    const [row] = await request('devices', {
      method: 'PATCH',
      query: `device_id=eq.${encodeURIComponent(deviceId)}&select=*`,
      body: { last_seen: new Date().toISOString() },
      prefer: 'return=representation',
    });
    return row || null;
  },
  async revokeDevice(deviceId) {
    const [row] = await request('devices', {
      method: 'PATCH',
      query: `device_id=eq.${encodeURIComponent(deviceId)}&select=*`,
      body: { revoked: true, token_hash: null },
      prefer: 'return=representation',
    });
    return row || null;
  },
  async queueOutboundMessage(deviceId, payload) {
    const [row] = await request('sms_outbox', {
      method: 'POST',
      query: 'select=*',
      body: {
        id: payload.id,
        device_id: deviceId,
        recipient: payload.to,
        body: payload.body,
        segments: payload.segments || [],
        status: 'queued',
        expires_at: new Date(payload.expiresAt || Date.now() + 600_000).toISOString(),
      },
      prefer: 'return=representation',
    });
    return row;
  },
  async getOutbox(deviceId) {
    const rows = await request('sms_outbox', {
      query: `device_id=eq.${encodeURIComponent(deviceId)}&status=eq.queued&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=*&order=created_at.asc`,
    });
    return rows.map((row) => ({
      id: row.id,
      to: row.recipient,
      body: row.body,
      segments: row.segments || [],
      status: row.status,
      expiresAt: Date.parse(row.expires_at),
    }));
  },
  async waitForOutbox(deviceId, timeoutMs = 25_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const items = await this.getOutbox(deviceId);
      if (items.length) return items;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return [];
  },
  async ackOutboundMessage(deviceId, id, status) {
    const [existing] = await request('sms_outbox', {
      query: `device_id=eq.${encodeURIComponent(deviceId)}&id=eq.${encodeURIComponent(id)}&select=*&limit=1`,
    });
    if (!existing || Date.parse(existing.expires_at) <= Date.now()) {
      if (existing && existing.status === 'queued') {
        await request('sms_outbox', {
          method: 'PATCH',
          query: `device_id=eq.${encodeURIComponent(deviceId)}&id=eq.${encodeURIComponent(id)}`,
          body: { status: 'expired' },
          prefer: 'return=minimal',
        });
        await this.updateMessageStatus(id, 'expired');
      }
      return null;
    }
    assertMessageStatusTransition(existing.status, status);
    const [row] = await request('sms_outbox', {
      method: 'PATCH',
      query: `device_id=eq.${encodeURIComponent(deviceId)}&id=eq.${encodeURIComponent(id)}&select=*`,
      body: { status },
      prefer: 'return=representation',
    });
    await request('messages', {
      method: 'PATCH',
      query: `provider_message_id=eq.${encodeURIComponent(id)}`,
      body: { status },
      prefer: 'return=minimal',
    });
    return row || null;
  },
  async cleanupExpiredData({ retentionDays = 30 } = {}) {
    return request('rpc/cleanup_expired_data', {
      method: 'POST',
      body: { retention_days: retentionDays },
      prefer: 'return=representation',
    });
  },
};

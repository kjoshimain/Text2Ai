import crypto from 'node:crypto';

const conversations = new Map();
const messages = new Map();
const devices = new Map();
const outbox = new Map();
const runs = new Map();

export function createConversation({ phoneHash, phoneMasked }) {
  const id = crypto.randomUUID();
  const entry = {
    id,
    phone_hash: phoneHash,
    phone_masked: phoneMasked,
    created_at: new Date().toISOString(),
  };
  conversations.set(id, entry);
  return entry;
}

export function listConversations() {
  return [...conversations.values()];
}

export function getConversation(id) {
  return conversations.get(id) || null;
}

export function saveMessage({ conversationId, direction, body, providerMessageId, status = 'queued', segments = 1 }) {
  const id = crypto.randomUUID();
  const record = {
    id,
    conversation_id: conversationId,
    direction,
    body,
    provider_message_id: providerMessageId || null,
    status,
    segments,
    created_at: new Date().toISOString(),
  };
  const bucket = messages.get(conversationId) || [];
  bucket.push(record);
  messages.set(conversationId, bucket);
  return record;
}

export function listMessages(conversationId) {
  return messages.get(conversationId) || [];
}

export function addResearchRun(runId, payload) {
  runs.set(runId, { ...payload, createdAt: new Date().toISOString() });
  return runs.get(runId);
}

export function getResearchRun(runId) {
  return runs.get(runId) || null;
}

export function registerDevice(deviceId, data) {
  devices.set(deviceId, { ...data, last_seen: new Date().toISOString() });
  return devices.get(deviceId);
}

export function getDevice(deviceId) {
  return devices.get(deviceId) || null;
}

export function listDevices() {
  return [...devices.values()];
}

export function queueOutboundMessage(deviceId, payload) {
  const bucket = outbox.get(deviceId) || [];
  bucket.push(payload);
  outbox.set(deviceId, bucket);
  return payload;
}

export function getOutbox(deviceId) {
  return outbox.get(deviceId) || [];
}

export function ackOutboundMessage(deviceId, id, status) {
  const bucket = outbox.get(deviceId) || [];
  const next = bucket.map((item) => (item.id === id ? { ...item, status } : item));
  outbox.set(deviceId, next);
  return next;
}

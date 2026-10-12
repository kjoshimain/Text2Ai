import crypto from 'node:crypto';
import { assertMessageStatusTransition } from '../../utils/messageStatus.js';

const conversations = new Map();
const conversationsByPhone = new Map();
const messages = new Map();
const messagesByProviderId = new Map();
const devices = new Map();
const pairingCodes = new Map();
const inboundDedupe = new Map();
const outbox = new Map();
const outboxWaiters = new Map();
const runs = new Map();

export function resetMemoryStore() {
  conversations.clear();
  conversationsByPhone.clear();
  messages.clear();
  messagesByProviderId.clear();
  devices.clear();
  pairingCodes.clear();
  inboundDedupe.clear();
  outbox.clear();
  outboxWaiters.clear();
  runs.clear();
}

export function createConversation({ phoneHash, phoneMasked }) {
  const existingId = conversationsByPhone.get(phoneHash);
  if (existingId) return conversations.get(existingId);
  const entry = {
    id: crypto.randomUUID(),
    phone_hash: phoneHash,
    phone_masked: phoneMasked,
    created_at: new Date().toISOString(),
  };
  conversations.set(entry.id, entry);
  conversationsByPhone.set(phoneHash, entry.id);
  messages.set(entry.id, []);
  return entry;
}

export function findConversationByPhoneHash(phoneHash) {
  const id = conversationsByPhone.get(phoneHash);
  return id ? conversations.get(id) : null;
}

export function listConversations() {
  return [...conversations.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function getConversation(id) {
  return conversations.get(id) || null;
}

export function saveMessage({
  conversationId,
  direction,
  body,
  providerMessageId,
  status = 'queued',
  segments = 1,
}) {
  if (providerMessageId && messagesByProviderId.has(providerMessageId)) {
    return messagesByProviderId.get(providerMessageId);
  }
  const record = {
    id: crypto.randomUUID(),
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
  if (providerMessageId) messagesByProviderId.set(providerMessageId, record);
  return record;
}

export function updateMessageStatus(providerMessageId, status) {
  const message = messagesByProviderId.get(providerMessageId);
  if (!message) return null;
  message.status = status;
  return message;
}

export function listMessages(conversationId) {
  return [...(messages.get(conversationId) || [])];
}

export function addResearchRun(runId, payload) {
  runs.set(runId, { ...payload, runId, createdAt: new Date().toISOString() });
  return runs.get(runId);
}

export function getResearchRun(runId) {
  return runs.get(runId) || null;
}

export function createPairingCode(code, { expiresAt }) {
  pairingCodes.set(code, { expiresAt });
}

export function consumePairingCode(code) {
  const entry = pairingCodes.get(code);
  if (!entry || entry.expiresAt <= Date.now()) {
    pairingCodes.delete(code);
    return false;
  }
  pairingCodes.delete(code);
  return true;
}

export function claimInboundDedupe(key, { expiresAt }) {
  const existingExpiry = inboundDedupe.get(key);
  if (existingExpiry && existingExpiry > Date.now()) return false;
  inboundDedupe.set(key, expiresAt);
  return true;
}

export function registerDevice(deviceId, data) {
  const previous = devices.get(deviceId);
  const entry = {
    deviceId,
    ...previous,
    ...data,
    last_seen: new Date().toISOString(),
    revoked: false,
  };
  devices.set(deviceId, entry);
  return entry;
}

export function findDeviceByTokenHash(tokenHash) {
  return [...devices.values()].find((device) => !device.revoked && device.token_hash === tokenHash) || null;
}

export function getDevice(deviceId) {
  return devices.get(deviceId) || null;
}

export function listDevices() {
  return [...devices.values()].map((device) => ({
    ...device,
    queue_length: (outbox.get(device.deviceId) || []).filter((item) => item.status === 'queued').length,
  }));
}

export function touchDevice(deviceId) {
  const device = devices.get(deviceId);
  if (!device) return null;
  device.last_seen = new Date().toISOString();
  return device;
}

export function revokeDevice(deviceId) {
  const device = devices.get(deviceId);
  if (!device) return null;
  device.revoked = true;
  device.token_hash = null;
  return device;
}

export function queueOutboundMessage(deviceId, payload) {
  pruneOutbox(deviceId);
  const bucket = outbox.get(deviceId) || [];
  const item = {
    ...payload,
    deviceId,
    status: payload.status || 'queued',
    createdAt: payload.createdAt || Date.now(),
    expiresAt: payload.expiresAt || Date.now() + 10 * 60_000,
  };
  bucket.push(item);
  outbox.set(deviceId, bucket);
  for (const wake of outboxWaiters.get(deviceId) || []) wake();
  outboxWaiters.delete(deviceId);
  return item;
}

export function getOutbox(deviceId) {
  pruneOutbox(deviceId);
  return (outbox.get(deviceId) || []).filter((item) => item.status === 'queued');
}

export async function waitForOutbox(deviceId, timeoutMs = 25_000) {
  const available = getOutbox(deviceId);
  if (available.length) return available;
  await new Promise((resolve) => {
    const waiters = outboxWaiters.get(deviceId) || new Set();
    const finish = () => {
      clearTimeout(timer);
      waiters.delete(finish);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    waiters.add(finish);
    outboxWaiters.set(deviceId, waiters);
  });
  return getOutbox(deviceId);
}

export function ackOutboundMessage(deviceId, id, status) {
  pruneOutbox(deviceId);
  const bucket = outbox.get(deviceId) || [];
  const item = bucket.find((message) => message.id === id);
  if (!item) return null;
  assertMessageStatusTransition(item.status, status);
  item.status = status;
  item.updatedAt = Date.now();
  updateMessageStatus(id, status);
  return item;
}

export function cleanupExpiredData({ retentionDays = 30 } = {}) {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60_000;
  let deletedMessages = 0;
  for (const [conversationId, bucket] of messages) {
    const retained = bucket.filter((message) => {
      const keep = Date.parse(message.created_at) >= cutoff;
      if (!keep && message.provider_message_id) messagesByProviderId.delete(message.provider_message_id);
      if (!keep) deletedMessages += 1;
      return keep;
    });
    messages.set(conversationId, retained);
    if (!retained.length) {
      const conversation = conversations.get(conversationId);
      if (conversation && Date.parse(conversation.created_at) < cutoff) {
        conversations.delete(conversationId);
        conversationsByPhone.delete(conversation.phone_hash);
        messages.delete(conversationId);
      }
    }
  }
  for (const [runId, run] of runs) {
    const createdAt = Date.parse(run.createdAt || '');
    if (Number.isFinite(createdAt) && createdAt < cutoff) runs.delete(runId);
  }
  for (const [code, pairing] of pairingCodes) {
    if (pairing.expiresAt <= Date.now()) pairingCodes.delete(code);
  }
  for (const [key, expiresAt] of inboundDedupe) {
    if (expiresAt <= Date.now()) inboundDedupe.delete(key);
  }
  for (const deviceId of outbox.keys()) pruneOutbox(deviceId);
  return { deletedMessages };
}

function pruneOutbox(deviceId) {
  const bucket = outbox.get(deviceId) || [];
  const retained = bucket.filter((item) => {
    if (item.expiresAt > Date.now()) return true;
    if (item.status === 'queued') {
      item.status = 'expired';
      item.updatedAt = Date.now();
      updateMessageStatus(item.id, 'expired');
    }
    return false;
  });
  outbox.set(deviceId, retained);
}

export const memoryStore = {
  createConversation,
  findConversationByPhoneHash,
  listConversations,
  getConversation,
  saveMessage,
  updateMessageStatus,
  listMessages,
  addResearchRun,
  getResearchRun,
  createPairingCode,
  consumePairingCode,
  claimInboundDedupe,
  registerDevice,
  findDeviceByTokenHash,
  getDevice,
  listDevices,
  touchDevice,
  revokeDevice,
  queueOutboundMessage,
  getOutbox,
  waitForOutbox,
  ackOutboundMessage,
  cleanupExpiredData,
};

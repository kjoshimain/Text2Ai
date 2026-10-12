import { env } from '../../config/env.js';
import { memoryStore } from './memory.js';
import { supabaseStore } from './supabase.js';

const hasSupabaseUrl = Boolean(env.supabaseUrl);
const hasSupabaseKey = Boolean(env.supabaseKey);
if (hasSupabaseUrl !== hasSupabaseKey) {
  throw new Error('Set both SUPABASE_URL and SUPABASE_KEY, or leave both empty to use the in-memory store.');
}
if (env.nodeEnv === 'production' && !hasSupabaseUrl) {
  throw new Error('SUPABASE_URL and SUPABASE_KEY are required in production; in-memory storage is not durable across serverless invocations.');
}

export const store = hasSupabaseUrl ? supabaseStore : memoryStore;
export const activeStore = hasSupabaseUrl ? 'supabase' : 'memory';

export const createConversation = (...args) => store.createConversation(...args);
export const findConversationByPhoneHash = (...args) => store.findConversationByPhoneHash(...args);
export const listConversations = (...args) => store.listConversations(...args);
export const getConversation = (...args) => store.getConversation(...args);
export const saveMessage = (...args) => store.saveMessage(...args);
export const updateMessageStatus = (...args) => store.updateMessageStatus(...args);
export const listMessages = (...args) => store.listMessages(...args);
export const addResearchRun = (...args) => store.addResearchRun(...args);
export const getResearchRun = (...args) => store.getResearchRun(...args);
export const createPairingCode = (...args) => store.createPairingCode(...args);
export const consumePairingCode = (...args) => store.consumePairingCode(...args);
export const claimInboundDedupe = (...args) => store.claimInboundDedupe(...args);
export const registerDevice = (...args) => store.registerDevice(...args);
export const findDeviceByTokenHash = (...args) => store.findDeviceByTokenHash(...args);
export const getDevice = (...args) => store.getDevice(...args);
export const listDevices = (...args) => store.listDevices(...args);
export const touchDevice = (...args) => store.touchDevice(...args);
export const revokeDevice = (...args) => store.revokeDevice(...args);
export const queueOutboundMessage = (...args) => store.queueOutboundMessage(...args);
export const getOutbox = (...args) => store.getOutbox(...args);
export const waitForOutbox = (...args) => store.waitForOutbox(...args);
export const ackOutboundMessage = (...args) => store.ackOutboundMessage(...args);
export const cleanupExpiredData = (...args) => store.cleanupExpiredData(...args);

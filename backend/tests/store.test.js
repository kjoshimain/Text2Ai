import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ackOutboundMessage,
  claimInboundDedupe,
  createConversation,
  createPairingCode,
  consumePairingCode,
  getOutbox,
  queueOutboundMessage,
  resetMemoryStore,
  listMessages,
  saveMessage,
  waitForOutbox,
} from '../src/services/store/memory.js';

test('pairing codes are short lived and single use', () => {
  resetMemoryStore();
  createPairingCode('ABC123', { expiresAt: Date.now() + 1_000 });
  assert.equal(consumePairingCode('ABC123'), true);
  assert.equal(consumePairingCode('ABC123'), false);

  createPairingCode('OLD123', { expiresAt: Date.now() - 1 });
  assert.equal(consumePairingCode('OLD123'), false);
});

test('store idempotency claim deduplicates within its expiry window', async () => {
  resetMemoryStore();
  assert.equal(claimInboundDedupe('key-1', { expiresAt: Date.now() + 10 }), true);
  assert.equal(claimInboundDedupe('key-1', { expiresAt: Date.now() + 10 }), false);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(claimInboundDedupe('key-1', { expiresAt: Date.now() + 10 }), true);
});

test('outbox long poll wakes on queue insertion and ack updates message state', async () => {
  resetMemoryStore();
  const conversation = createConversation({ phoneHash: 'hashed', phoneMasked: '+91*****3210' });
  const message = {
    id: 'message-1',
    to: '+919876543210',
    body: 'reply',
    segments: ['reply'],
    expiresAt: Date.now() + 30_000,
  };
  await new Promise((resolve) => {
    const waiting = waitForOutbox('device-1', 1_000);
    setTimeout(() => {
      queueOutboundMessage('device-1', message);
      saveMessage({
        conversationId: conversation.id,
        direction: 'outbound',
        body: message.body,
        providerMessageId: message.id,
        status: 'queued',
        segments: 1,
      });
      resolve(waiting);
    }, 10);
  });

  const items = getOutbox('device-1');
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'message-1');
  const updated = ackOutboundMessage('device-1', 'message-1', 'delivered');
  assert.equal(updated.status, 'delivered');
  assert.throws(() => ackOutboundMessage('device-1', 'message-1', 'failed'), /Cannot change message status/);
  assert.deepEqual(getOutbox('device-1'), []);
});

test('expired outbox items are removed and cannot be acknowledged', () => {
  resetMemoryStore();
  const conversation = createConversation({ phoneHash: 'hash-expired', phoneMasked: '*****3210' });
  queueOutboundMessage('device-1', {
    id: 'expired',
    to: '+919876543210',
    body: 'old',
    segments: ['old'],
    expiresAt: Date.now() - 1,
  });
  saveMessage({
    conversationId: conversation.id,
    direction: 'outbound',
    body: 'old',
    providerMessageId: 'expired',
    status: 'queued',
  });
  assert.deepEqual(getOutbox('device-1'), []);
  assert.equal(ackOutboundMessage('device-1', 'expired', 'sent'), null);
  assert.equal(listMessages(conversation.id)[0].status, 'expired');
});

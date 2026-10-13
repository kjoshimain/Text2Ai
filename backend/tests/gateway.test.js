import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pino from 'pino';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { resetMemoryStore } from '../src/services/store/memory.js';
import { clearMockSms, listMockSms } from '../src/services/sms/mock.js';

function sign(token, body) {
  return crypto.createHmac('sha256', token).update(body).digest('hex');
}

function setAdminSecret(t) {
  const original = env.gatewayPairingSecret;
  env.gatewayPairingSecret = 'test-only-gateway-admin-secret-long-enough';
  t.after(() => { env.gatewayPairingSecret = original; });
}

test('gateway pairing, signed inbound, dedupe, outbox and ack work end to end', async (t) => {
  setAdminSecret(t);
  resetMemoryStore();
  const app = createApp({ logger: pino({ level: 'silent' }) });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const pairingResponse = await fetch(`${baseUrl}/api/gateway/pairing-code`, {
    method: 'POST',
    headers: { 'x-gateway-admin-key': env.gatewayPairingSecret },
  });
  assert.equal(pairingResponse.status, 201);
  const { code } = await pairingResponse.json();

  const pairBody = JSON.stringify({ deviceId: 'test-gateway', pairingCode: code });
  const pairResponse = await fetch(`${baseUrl}/api/gateway/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: pairBody,
  });
  assert.equal(pairResponse.status, 201);
  const { token } = await pairResponse.json();

  const inbound = { deviceId: 'test-gateway', from: '+919876543210', body: 'HELP', smsId: 'sms-1' };
  const inboundBody = JSON.stringify(inbound);
  const inboundResponse = await fetch(`${baseUrl}/api/gateway/inbound`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      'x-device-signature': sign(token, inboundBody),
    },
    body: inboundBody,
  });
  assert.equal(inboundResponse.status, 202);

  const duplicateResponse = await fetch(`${baseUrl}/api/gateway/inbound`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      'x-device-signature': sign(token, inboundBody),
    },
    body: inboundBody,
  });
  assert.equal(duplicateResponse.status, 200);
  assert.equal((await duplicateResponse.json()).duplicate, true);

  const outboxResponse = await fetch(`${baseUrl}/api/gateway/outbox`, {
    headers: {
      authorization: `Bearer ${token}`,
      'x-device-signature': sign(token, ''),
    },
  });
  assert.equal(outboxResponse.status, 200);
  const { items } = await outboxResponse.json();
  assert.equal(items.length, 1);
  assert.match(items[0].body, /Reply HELP/);
  assert.ok(Array.isArray(items[0].segments));

  const ack = { messageId: items[0].id, status: 'delivered' };
  const ackBody = JSON.stringify(ack);
  const ackResponse = await fetch(`${baseUrl}/api/gateway/ack`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      'x-device-signature': sign(token, ackBody),
    },
    body: ackBody,
  });
  assert.equal(ackResponse.status, 200);
  assert.equal((await ackResponse.json()).status, 'delivered');

  const revokeResponse = await fetch(`${baseUrl}/api/gateway/devices/test-gateway/revoke`, {
    method: 'POST',
    headers: { 'x-gateway-admin-key': env.gatewayPairingSecret },
  });
  assert.equal(revokeResponse.status, 200);
  const revokedRequest = await fetch(`${baseUrl}/api/gateway/outbox`, {
    headers: {
      authorization: `Bearer ${token}`,
      'x-device-signature': sign(token, ''),
    },
  });
  assert.equal(revokedRequest.status, 401);
});

test('gateway pairing and device administration require the configured admin key', async (t) => {
  resetMemoryStore();
  const original = env.gatewayPairingSecret;
  env.gatewayPairingSecret = '';
  t.after(() => { env.gatewayPairingSecret = original; });
  const app = createApp({ logger: pino({ level: 'silent' }) });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/gateway`;

  const disabled = await fetch(`${baseUrl}/pairing-code`, { method: 'POST' });
  assert.equal(disabled.status, 503);
  env.gatewayPairingSecret = 'test-only-gateway-admin-secret-long-enough';

  const unauthorized = await fetch(`${baseUrl}/pairing-code`, { method: 'POST' });
  assert.equal(unauthorized.status, 401);
  const wrongKey = await fetch(`${baseUrl}/devices`, {
    headers: { 'x-gateway-admin-key': 'not-the-admin-key' },
  });
  assert.equal(wrongKey.status, 401);
  const authorized = await fetch(`${baseUrl}/pairing-code`, {
    method: 'POST',
    headers: { 'x-gateway-admin-key': env.gatewayPairingSecret },
  });
  assert.equal(authorized.status, 201);
});

test('gateway rejects missing auth and invalid HMAC signatures', async (t) => {
  resetMemoryStore();
  const app = createApp({ logger: pino({ level: 'silent' }) });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/gateway/outbox`, {
    headers: { 'x-device-signature': sign('secret', '') },
  });
  assert.equal(response.status, 401);
});

test('gateway outbox returns promptly when there are no queued replies', async (t) => {
  resetMemoryStore();
  const app = createApp({ logger: pino({ level: 'silent' }) });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  setAdminSecret(t);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const pairing = await fetch(`${baseUrl}/api/gateway/pairing-code`, {
    method: 'POST',
    headers: { 'x-gateway-admin-key': env.gatewayPairingSecret },
  });
  const { code } = await pairing.json();
  const pairBody = JSON.stringify({ deviceId: 'idle-gateway', pairingCode: code });
  const pair = await fetch(`${baseUrl}/api/gateway/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: pairBody,
  });
  const { token } = await pair.json();
  const originalPollMs = env.outboxLongPollMs;
  env.outboxLongPollMs = 100;
  t.after(() => { env.outboxLongPollMs = originalPollMs; });

  const startedAt = Date.now();
  const response = await fetch(`${baseUrl}/api/gateway/outbox`, {
    headers: {
      authorization: `Bearer ${token}`,
      'x-device-signature': sign(token, ''),
    },
  });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).items, []);
  assert.ok(Date.now() - startedAt < 1_500, 'idle polling should return quickly');
});

test('simulator validates input and uses the mock SMS adapter', async (t) => {
  resetMemoryStore();
  clearMockSms();
  const app = createApp({ logger: pino({ level: 'silent' }) });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  const base = `http://127.0.0.1:${server.address().port}/api/simulate-sms`;
  const invalid = await fetch(base, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ from: '+919876543210', body: '   ' }),
  });
  assert.equal(invalid.status, 400);

  const response = await fetch(base, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ from: '+919876543210', body: 'HELP' }),
  });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.delivery.status, 'sent');
  assert.equal(data.run.status, 'completed');
  assert.equal(listMockSms().length, 1);
});

test('sixth inbound question from a phone receives the polite rate-limit reply', async (t) => {
  setAdminSecret(t);
  resetMemoryStore();
  const app = createApp({ logger: pino({ level: 'silent' }) });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const pairing = await fetch(`${base}/api/gateway/pairing-code`, {
    method: 'POST',
    headers: { 'x-gateway-admin-key': env.gatewayPairingSecret },
  });
  const { code } = await pairing.json();
  const pairBody = JSON.stringify({ deviceId: 'rate-limit-device', pairingCode: code });
  const pair = await fetch(`${base}/api/gateway/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: pairBody,
  });
  const { token } = await pair.json();

  for (let index = 0; index < 6; index += 1) {
    const body = JSON.stringify({
      from: '+919876500001',
      body: `question ${index}`,
      smsId: `rate-sms-${index}`,
    });
    const response = await fetch(`${base}/api/gateway/inbound`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'x-device-signature': sign(token, body),
      },
      body,
    });
    assert.equal(response.status, 202);
  }

  await new Promise((resolve) => setTimeout(resolve, 50));
  const outbox = await fetch(`${base}/api/gateway/outbox`, {
    headers: {
      authorization: `Bearer ${token}`,
      'x-device-signature': sign(token, ''),
    },
  });
  const { items } = await outbox.json();
  assert.equal(items.length, 6);
  assert.match(items[5].body, /question limit for this hour/i);
});

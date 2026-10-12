import crypto from 'node:crypto';

const sentMessages = [];

export async function sendMockSms({ to, body, segments }) {
  const message = {
    ok: true,
    provider: 'mock',
    to,
    body,
    segments,
    messageId: `mock-${crypto.randomUUID()}`,
    createdAt: new Date().toISOString(),
  };
  sentMessages.push(message);
  return message;
}

export function listMockSms() {
  return [...sentMessages];
}

export function clearMockSms() {
  sentMessages.length = 0;
}

export function parseMockInbound(request) {
  return request.body;
}

export function verifyMockRequest() {
  return true;
}

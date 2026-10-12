import crypto from 'node:crypto';
import { queueOutboundMessage } from '../store/index.js';
import { splitSmsMessage } from '../../utils/smsSegments.js';
import { verifyHmac } from '../../utils/security.js';

export async function sendAndroidGatewaySms({ to, body, deviceId = 'gateway', maxSegments = 3 }) {
  const segments = Array.isArray(body) ? body : splitSmsMessage(body, maxSegments);
  const item = {
    id: crypto.randomUUID(),
    to,
    body: segments.join(''),
    segments,
    status: 'queued',
    createdAt: Date.now(),
    expiresAt: Date.now() + 10 * 60_000,
  };
  await queueOutboundMessage(deviceId, item);
  return { ok: true, provider: 'android-gateway', messageId: item.id, segments };
}

export function parseAndroidGatewayInbound(request) {
  return request.body;
}

export function verifyAndroidGatewayRequest(request, token) {
  const rawBody = request.rawBody || '';
  const signature = request.get?.('x-device-signature') || request.headers?.['x-device-signature'];
  return verifyHmac(token, rawBody, signature);
}

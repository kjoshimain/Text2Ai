import { sendMockSms, parseMockInbound, verifyMockRequest } from './mock.js';
import {
  sendAndroidGatewaySms,
  parseAndroidGatewayInbound,
  verifyAndroidGatewayRequest,
} from './android-gateway.js';
import {
  sendTwilioSms,
  parseTwilioInbound,
  verifyTwilioRequest,
} from './twilio.js';

export const smsAdapters = {
  mock: {
    send: sendMockSms,
    parseInbound: parseMockInbound,
    verify: verifyMockRequest,
  },
  'android-gateway': {
    send: sendAndroidGatewaySms,
    parseInbound: parseAndroidGatewayInbound,
    verify: verifyAndroidGatewayRequest,
  },
  twilio: {
    send: sendTwilioSms,
    parseInbound: parseTwilioInbound,
    verify: verifyTwilioRequest,
  },
};

export async function sendSms({ to, body, segments, provider = process.env.SMS_PROVIDER || 'mock' }) {
  const adapter = smsAdapters[provider];
  if (!adapter) throw new Error(`Unknown SMS provider: ${provider}`);
  return adapter.send({ to, body, segments });
}

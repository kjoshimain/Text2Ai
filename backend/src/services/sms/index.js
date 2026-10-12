import { sendMockSms } from './mock.js';
import { sendAndroidGatewaySms } from './android-gateway.js';
import { sendTwilioSms } from './twilio.js';

const adapters = {
  mock: sendMockSms,
  'android-gateway': sendAndroidGatewaySms,
  twilio: sendTwilioSms,
};

export async function sendSms({ to, body, provider = process.env.SMS_PROVIDER || 'mock' }) {
  const adapter = adapters[provider] || sendMockSms;
  return adapter({ to, body });
}

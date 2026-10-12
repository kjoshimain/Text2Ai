export async function sendTwilioSms({ to, body }) {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    return { ok: false, provider: 'twilio', error: 'Twilio credentials not configured' };
  }

  return {
    ok: true,
    provider: 'twilio',
    to,
    body,
    messageId: `twilio-${Date.now()}`,
  };
}

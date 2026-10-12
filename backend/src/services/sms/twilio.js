import crypto from 'node:crypto';

export async function sendTwilioSms() {
  return {
    ok: false,
    provider: 'twilio',
    error: 'Twilio sending is not implemented; configure a provider integration before selecting it.',
  };
}

export function verifyTwilioSignature({ url, params, signature, authToken = process.env.TWILIO_AUTH_TOKEN }) {
  if (!url || !params || !signature || !authToken) return false;
  const canonicalParams = Object.keys(params)
    .sort()
    .map((key) => `${key}${params[key]}`)
    .join('');
  const expected = crypto.createHmac('sha1', authToken).update(`${url}${canonicalParams}`).digest('base64');
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(String(signature));
  return expectedBuffer.length === signatureBuffer.length
    && crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
}

export function parseTwilioInbound(request) {
  const { From: from, Body: body, MessageSid: smsId } = request.body || {};
  return { from, body, smsId };
}

export function verifyTwilioRequest(request) {
  return verifyTwilioSignature({
    url: request.originalUrl ? `${request.protocol}://${request.get('host')}${request.originalUrl}` : '',
    params: request.body || {},
    signature: request.get?.('x-twilio-signature'),
  });
}

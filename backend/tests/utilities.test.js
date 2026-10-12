import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { countSmsSegments, formatSmsReply, getSmsEncoding, splitSmsMessage } from '../src/utils/smsSegments.js';
import { detectLanguage, normalizeText } from '../src/utils/lang.js';
import { maskPhone, normalizePhone } from '../src/utils/phone.js';
import { createDedupeKey, DedupeWindow } from '../src/utils/dedupe.js';
import { FixedWindowRateLimiter } from '../src/utils/rateLimit.js';
import { hmacSha256, verifyHmac } from '../src/utils/security.js';
import { verifyTwilioSignature } from '../src/services/sms/twilio.js';
import { clearMockSms, listMockSms, sendMockSms } from '../src/services/sms/mock.js';
import { retryWithBackoff } from '../src/utils/retry.js';

test('GSM-7 and UCS-2 boundaries use concatenated-message capacities', () => {
  assert.equal(getSmsEncoding('hello'), 'GSM-7');
  assert.equal(countSmsSegments('a'.repeat(160)), 1);
  assert.equal(countSmsSegments('a'.repeat(161)), 2);
  assert.equal(countSmsSegments('a'.repeat(306)), 2);
  assert.equal(countSmsSegments('a'.repeat(307)), 3);
  assert.equal(getSmsEncoding('नमस्ते'), 'UCS-2');
  assert.equal(countSmsSegments('न'.repeat(70)), 1);
  assert.equal(countSmsSegments('न'.repeat(71)), 2);
});

test('GSM extension characters use two septets and split never breaks Unicode characters', () => {
  assert.equal(countSmsSegments('^'.repeat(81)), 2);
  const parts = splitSmsMessage('😀'.repeat(100), 4);
  assert.equal(parts.length, 4);
  assert.equal(countSmsSegments('😀'.repeat(100)), 4);
  assert.equal(parts.join(''), '😀'.repeat(100));
  assert.ok(parts.every((part) => !part.endsWith('\uD83D')));
});

test('word boundary splitting respects the multipart cap', () => {
  const parts = splitSmsMessage('answer '.repeat(60), 3);
  assert.ok(parts.length <= 3);
  assert.equal(parts.join(''), 'answer '.repeat(60).trim());
});

test('format keeps answer first and omits URLs that exceed the segment cap', () => {
  const url = `https://example.com/${'long-path-'.repeat(80)}`;
  const result = formatSmsReply('Short answer.', [url], 3);
  assert.equal(result.body, 'Short answer.');
  assert.deepEqual(result.segments, ['Short answer.']);
});

test('language detection and control-character normalization are deterministic', () => {
  assert.equal(detectLanguage('छात्रवृत्ति की पात्रता क्या है?'), 'hi');
  assert.equal(detectLanguage('What documents are needed?'), 'en');
  assert.equal(normalizeText('A\u0000  B\nC'), 'A B C');
});

test('phone numbers normalize and mask without exposing the full number', () => {
  assert.equal(normalizePhone('+91 98765 43210'), '+919876543210');
  assert.equal(normalizePhone('9876543210'), '+919876543210');
  assert.equal(maskPhone('+919876543210'), '+91*****3210');
  assert.equal(maskPhone('9876543210'), '*****3210');
  assert.throws(() => normalizePhone('1234'), /8 to 15 digits/);
});

test('fallback dedupe hashes normalized phone and message for a 2-minute window', () => {
  let now = 10_000;
  const window = new DedupeWindow({ windowMs: 120_000, now: () => now });
  const key = createDedupeKey({ phone: '+91 98765 43210', body: '  hello  ' });
  assert.equal(key, createDedupeKey({ phone: '+919876543210', body: 'hello' }));
  assert.equal(window.checkAndRemember(key), true);
  assert.equal(window.checkAndRemember(key), false);
  now += 120_001;
  assert.equal(window.checkAndRemember(key), true);
});

test('fixed-window limiter allows configured quota and reports retry time', () => {
  let now = 0;
  const limiter = new FixedWindowRateLimiter({ limit: 2, windowMs: 3_600_000, now: () => now });
  assert.equal(limiter.consume('phone').allowed, true);
  assert.equal(limiter.consume('phone').allowed, true);
  assert.deepEqual(limiter.consume('phone'), { allowed: false, remaining: 0, retryAfterMs: 3_600_000 });
  now = 3_600_000;
  assert.equal(limiter.consume('phone').allowed, true);
});

test('device request signature verifies body bytes and rejects tampering', () => {
  const body = '{"deviceId":"gw-1"}';
  const signature = hmacSha256('secret', body);
  assert.equal(verifyHmac('secret', body, signature), true);
  assert.equal(verifyHmac('secret', `${body} `, signature), false);
  assert.equal(verifyHmac('secret', body, ''), false);
});

test('Twilio signature validation matches HMAC-SHA1 canonical parameters', () => {
  const url = 'https://example.test/sms';
  const params = { Body: 'hello', From: '+15551234567' };
  const canonical = `${url}BodyhelloFrom+15551234567`;
  const signature = crypto.createHmac('sha1', 'test-token').update(canonical).digest('base64');
  assert.equal(verifyTwilioSignature({ url, params, signature, authToken: 'test-token' }), true);
  assert.equal(verifyTwilioSignature({ url, params, signature: 'invalid', authToken: 'test-token' }), false);
});

test('mock SMS adapter records outgoing messages and can be reset', async () => {
  clearMockSms();
  const sent = await sendMockSms({ to: '+919876543210', body: 'hello', segments: ['hello'] });
  assert.equal(sent.ok, true);
  assert.equal(listMockSms().length, 1);
  clearMockSms();
  assert.equal(listMockSms().length, 0);
});

test('retry uses bounded backoff and honors per-attempt timeouts', async () => {
  let attempts = 0;
  const value = await retryWithBackoff(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('temporary');
    return 'recovered';
  }, { retries: 1, baseMs: 1, jitter: false });
  assert.equal(value, 'recovered');
  assert.equal(attempts, 2);

  await assert.rejects(
    retryWithBackoff(() => new Promise((resolve) => setTimeout(resolve, 30)), {
      retries: 0,
      timeoutMs: 5,
    }),
    /timed out/i,
  );
});

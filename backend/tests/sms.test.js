import test from 'node:test';
import assert from 'node:assert/strict';
import { countSmsSegments, formatSmsReply } from '../src/utils/smsSegments.js';

test('English message fits in one SMS segment', () => {
  const result = formatSmsReply('Hello there from Text2AI', [], 3);
  assert.equal(result.segments, 1);
});

test('Hindi text can be counted with UCS-2 sizing', () => {
  const text = 'नमस्ते '.repeat(12);
  const segments = countSmsSegments(text);
  assert.ok(segments >= 2, `Expected more than one segment for long Hindi text, got ${segments}`);
});

test('Mixed English and Hindi text still counts as multi-part when long', () => {
  const text = 'Eligibility for scholarship is required for the applicant in Hindi नमस्ते '.repeat(10);
  const segments = countSmsSegments(text);
  assert.ok(segments >= 2, `Expected more than one segment, got ${segments}`);
});

test('Long URLs are truncated safely', () => {
  const url = 'https://example.com/very-long-path-' + 'segment'.repeat(40);
  const result = formatSmsReply('Please review this official link.', [url], 3);
  assert.ok(result.body.length > 0);
  assert.ok(result.segments <= 3);
});

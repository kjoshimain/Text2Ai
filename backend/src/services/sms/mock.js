export async function sendMockSms({ to, body }) {
  return {
    ok: true,
    provider: 'mock',
    to,
    body,
    messageId: `mock-${Date.now()}`,
  };
}

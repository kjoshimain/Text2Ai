export async function sendAndroidGatewaySms({ to, body }) {
  return {
    ok: true,
    provider: 'android-gateway',
    to,
    body,
    messageId: `device-${Date.now()}`,
  };
}

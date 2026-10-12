export async function retryWithBackoff(
  operation,
  {
    retries = 2,
    baseMs = 250,
    maxMs = 5_000,
    jitter = true,
    timeoutMs,
    signal,
    shouldRetry = () => true,
  } = {},
) {
  let attempt = 0;
  while (true) {
    if (signal?.aborted) throw signal.reason || new Error('Operation aborted');
    try {
      return await runAttempt(operation, { timeoutMs, signal });
    } catch (error) {
      if (signal?.aborted || attempt >= retries || !shouldRetry(error)) throw error;
      const backoff = Math.min(maxMs, baseMs * 2 ** attempt);
      const delay = jitter ? Math.floor(Math.random() * backoff) : backoff;
      await wait(delay, signal);
      attempt += 1;
    }
  }
}

async function runAttempt(operation, { timeoutMs, signal }) {
  if (!timeoutMs) return operation({ signal });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('Operation timed out')), timeoutMs);
  const abort = () => controller.abort(signal.reason || new Error('Operation aborted'));
  signal?.addEventListener('abort', abort, { once: true });
  try {
    return await Promise.race([
      operation({ signal: controller.signal }),
      new Promise((_, reject) => {
        controller.signal.addEventListener(
          'abort',
          () => reject(controller.signal.reason || new Error('Operation aborted')),
          { once: true },
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

function wait(delayMs, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason || new Error('Operation aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, delayMs);
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason || new Error('Operation aborted'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export async function retryWithBackoff(operation, { retries = 2, baseMs = 250, jitter = true } = {}) {
  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= retries) throw error;
      const delay = baseMs * 2 ** attempt + (jitter ? Math.random() * 120 : 0);
      await new Promise((resolve) => setTimeout(resolve, delay));
      attempt += 1;
    }
  }
}

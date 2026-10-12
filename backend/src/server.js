import pino from 'pino';
import { env } from './config/env.js';
import { createApp } from './app.js';

const logger = pino({ level: env.logLevel });
const app = createApp({ logger });
const server = app.listen(env.port, () => {
  logger.info({ port: env.port }, 'Text2AI backend listening');
});

const cleanupTimer = setInterval(() => {
  app.locals.cleanup().catch((error) => logger.error({
    errorName: error.name,
    errorCode: error.code,
  }, 'Retention cleanup failed'));
}, 24 * 60 * 60_000);
cleanupTimer.unref();
app.locals.cleanup().catch((error) => logger.error({
  errorName: error.name,
  errorCode: error.code,
}, 'Initial retention cleanup failed'));

function shutdown(signal) {
  logger.info({ signal }, 'Shutting down');
  clearInterval(cleanupTimer);
  server.close((error) => {
    if (error) {
      logger.error({ errorName: error.name, errorCode: error.code }, 'Server shutdown failed');
      process.exitCode = 1;
    }
  });
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

import { createApp } from './app.js';
import { config } from './config.js';

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`[api] listening on http://localhost:${config.port}`);
  console.log(
    `[api] simulation: failure_rate=${config.failureRate} delay=${config.minDelayMs}-${config.maxDelayMs}ms` +
      `${config.seed !== null ? ` seed=${config.seed}` : ''}`,
  );
});

/** Graceful shutdown so `npm run dev` restarts don't leave the port bound. */
function shutdown(signal) {
  console.log(`\n[api] ${signal} received, shutting down.`);
  server.close(() => process.exit(0));
  // Don't hang forever on a stuck connection.
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

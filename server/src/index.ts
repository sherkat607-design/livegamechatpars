import { buildApp } from './app';
import { loadConfig } from './config';

const config = loadConfig();
const { app, close } = await buildApp(config);

try {
  await app.listen({ port: config.port, host: config.host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    app.log.info(`${signal} received, shutting down`);
    await close().catch((err) => app.log.error(err));
    process.exit(0);
  });
}

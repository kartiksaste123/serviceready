import { serve } from '@hono/node-server';
import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 8080);
const server = serve({ fetch: createApp().fetch, port }, (info) => {
  console.log(`ServiceReady listening on port ${info.port}`);
});

const shutdown = (): void => {
  server.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

import { loadConfig, namespace } from './config';
import { Providers } from './providers';
import { Store } from './store';
import { World } from './world';
import { createApp, listen } from './server';

const config = loadConfig();
const store = new Store(config.db, namespace(config));
const running = listen(createApp(new World(store, new Providers(config))), config.port, config.host);

console.log(`AgentWorld (${config.mode}) listening at ${running.base} on Bun ${Bun.version} + bun:sqlite`);

let closing = false;
async function shutdown(code: number) {
  if (closing) return;
  closing = true;
  try { await running.stop(); } finally { store.close(); process.exit(code); }
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void shutdown(0); });

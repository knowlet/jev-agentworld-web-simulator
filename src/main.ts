import { loadConfig, namespace } from './config';
import { Providers } from './providers';
import { Store } from './store';
import { World } from './world';
import { createApp, listen } from './server';
const config = loadConfig();
const store = new Store(config.db, namespace(config));
const app = createApp(new World(store, new Providers(config)));
console.log(`AgentWorld (${config.mode}) listening at ${await listen(app, config.port, config.host)}`);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  app.close(() => { store.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 5000).unref();
});

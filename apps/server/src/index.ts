import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { openDatabase } from './db/index.ts';
import { applyPendingRestore } from './services/backup.ts';
import { startScheduler } from './services/scheduler.ts';
import { localAddresses } from './services/network.ts';

const config = loadConfig();
const restored = applyPendingRestore(config.dbFile, config.backupDir);
const db = openDatabase(config.dbFile);
const app = await buildApp({ config, db, logger: true });
if (restored) app.ctx.log.add('warn', `Base de datos restaurada desde ${restored}`);

const stopScheduler = startScheduler(app.ctx);

await app.listen({ port: config.port, host: config.host });
const urls = localAddresses().map((ip) => `http://${ip}:${config.port}`);
console.log('\n  Chicolven Vitrina en marcha');
console.log(`  Panel:     http://localhost:${config.port}/admin/`);
console.log(`  TVs:       http://localhost:${config.port}/tv/1`);
for (const url of urls) console.log(`  En la red: ${url}/admin/  ·  ${url}/tv/1`);
console.log(`  Datos:     ${config.dataDir}\n`);

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  app.log.info(`Recibido ${signal}, cerrando…`);
  stopScheduler();
  await app.close();
  db.close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

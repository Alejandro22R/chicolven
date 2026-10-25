import { exec } from 'node:child_process';
import { buildApp } from './app.ts';
import { loadConfig, readIni, ROOT_DIR } from './config.ts';
import { openDatabase } from './db/index.ts';
import { applyPendingRestore } from './services/backup.ts';
import { startScheduler } from './services/scheduler.ts';
import { addressesFor, LocalNameService } from './services/localName.ts';
import path from 'node:path';

async function main(): Promise<void> {
  const config = loadConfig();
  const restored = applyPendingRestore(config.dbFile, config.backupDir);
  const db = openDatabase(config.dbFile);
  const app = await buildApp({ config, db, logger: true });
  if (restored) app.ctx.log.add('warn', `Base de datos restaurada desde ${restored}`);

  const stopScheduler = startScheduler(app.ctx);

  try {
    await app.listen({ port: config.port, host: config.host });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      console.error(`\n  El puerto ${config.port} ya está en uso.`);
      console.error('  Probablemente Chicolven Vitrina ya está abierto (revise la barra de tareas),');
      console.error('  u otro programa usa ese puerto: cambie PORT en config.ini.\n');
      await waitAndExit(1);
    }
    throw err;
  }

  const localName = new LocalNameService(config.localName, app.ctx.log);
  localName.start();

  const port = config.port === 80 ? '' : `:${config.port}`;
  console.log('\n  Chicolven Vitrina en marcha');
  console.log(`  Panel:        http://localhost${port}/admin/`);
  console.log(`  Televisores:  http://${localName.host}${port}/1   (TV 1, /2 para TV 2…)`);
  for (const ip of addressesFor()) console.log(`  Por IP:       http://${ip}${port}/1`);
  console.log(`  Datos:        ${config.dataDir}`);
  console.log('  No cierre esta ventana: los televisores dejan de actualizarse.\n');

  // Packaged .exe: open the panel in the browser on start (ABRIR_PANEL=no in config.ini disables it;
  // the auto-start launcher sets CHICOLVEN_NO_BROWSER).
  const openPanel = readIni(path.join(ROOT_DIR, 'config.ini')).ABRIR_PANEL !== 'no' && !process.env.CHICOLVEN_NO_BROWSER;
  if (process.env.CHICOLVEN_PACKAGED && openPanel && process.platform === 'win32') {
    exec(`start "" "http://localhost${port}/admin/"`);
  }

  let closing = false;
  async function shutdown(signal: string) {
    if (closing) return;
    closing = true;
    app.log.info(`Recibido ${signal}, cerrando…`);
    localName.stop();
    stopScheduler();
    await app.close();
    db.close();
    process.exit(0);
  }
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

/** Keeps the console window open long enough to read the error when started by double-click. */
function waitAndExit(code: number): Promise<never> {
  return new Promise(() => setTimeout(() => process.exit(code), process.env.CHICOLVEN_PACKAGED ? 15_000 : 0));
}

main().catch((err) => {
  console.error(err);
  void waitAndExit(1);
});

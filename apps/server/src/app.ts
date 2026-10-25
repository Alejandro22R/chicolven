import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import { ZodError } from 'zod';
import type { DB } from './db/index.ts';
import { createRepos, type Repos } from './db/repositories/index.ts';
import { AuthService } from './services/auth.ts';
import { BackupService } from './services/backup.ts';
import { EventLog } from './services/eventLog.ts';
import { RateService, type RateServiceOptions } from './services/rateService.ts';
import { Hub } from './ws/hub.ts';
import type { AppConfig } from './config.ts';
import { authRoutes } from './routes/auth.ts';
import { catalogRoutes } from './routes/catalog.ts';
import { screenRoutes } from './routes/screens.ts';
import { rateRoutes } from './routes/rates.ts';
import { settingsRoutes } from './routes/settings.ts';
import { mediaRoutes } from './routes/media.ts';
import { systemRoutes } from './routes/system.ts';
import { playerRoutes } from './routes/player.ts';
import { staticRoutes } from './routes/static.ts';

export interface AppContext {
  config: AppConfig;
  db: DB;
  repos: Repos;
  rates: RateService;
  auth: AuthService;
  backups: BackupService;
  hub: Hub;
  log: EventLog;
  startedAt: Date;
  version: string;
}

export interface BuildOptions {
  config: AppConfig;
  db: DB;
  logger?: boolean;
  rateOptions?: Omit<RateServiceOptions, 'onChange' | 'log'>;
}

export const VERSION = '0.2.3';

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
  }
}

export async function buildApp(opts: BuildOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ? { level: 'info' } : false,
    bodyLimit: 2 * 1024 * 1024,
  });

  const repos = createRepos(opts.db);
  const hub = new Hub();
  const log = new EventLog(200, (e) => app.log[e.level](e.message));
  const rates = new RateService(repos, { ...opts.rateOptions, log, onChange: () => hub.contentChanged() });
  rates.checkActiveChanged();
  const ctx: AppContext = {
    config: opts.config,
    db: opts.db,
    repos,
    rates,
    auth: new AuthService(opts.db, repos.settings),
    backups: new BackupService(opts.db, opts.config.backupDir),
    hub,
    log,
    startedAt: new Date(),
    version: VERSION,
  };
  app.decorate('ctx', ctx);
  app.addHook('onClose', async () => hub.close());

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'Datos inválidos', issues: err.issues });
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) app.log.error(err);
    return reply.code(status).send({ error: status >= 500 ? 'Error interno' : (err as Error).message });
  });

  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
  await app.register(websocket);

  // Requests are only logged when something goes wrong (keeps the console readable and the PC idle).
  const quiet = { logLevel: 'warn' as const };
  for (const routes of [authRoutes, catalogRoutes, screenRoutes, rateRoutes, settingsRoutes, mediaRoutes, systemRoutes, playerRoutes, staticRoutes]) {
    await app.register(routes, quiet);
  }

  return app;
}

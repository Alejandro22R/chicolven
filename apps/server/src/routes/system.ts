import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import { z } from 'zod';
import { requireAdmin } from './auth.ts';

export async function systemRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAdmin);
  const { backups, log, hub, auth } = app.ctx;

  app.get('/api/admin/system', async () => {
    const mem = process.memoryUsage();
    return {
      version: app.ctx.version,
      node: process.version,
      started_at: app.ctx.startedAt.toISOString(),
      uptime_s: Math.round(process.uptime()),
      memory_mb: Math.round(mem.rss / 1_048_576),
      data_dir: app.ctx.config.dataDir,
      default_pin: auth.usingDefaultPin(),
      screens: hub.status(),
      logs: log.list().slice(0, 100),
    };
  });

  app.get('/api/admin/backups', async () => backups.list());

  app.post('/api/admin/backups', async () => {
    const info = await backups.create();
    log.add('info', `Respaldo creado: ${info.name}`);
    return info;
  });

  app.get('/api/admin/backups/:name', async (req, reply) => {
    const { name } = z.object({ name: z.string() }).parse(req.params);
    const file = backups.resolve(name);
    if (!file) return reply.code(404).send({ error: 'No encontrado' });
    reply.header('Content-Type', 'application/octet-stream');
    reply.header('Content-Disposition', `attachment; filename="${name}"`);
    return reply.send(fs.createReadStream(file));
  });

  app.post('/api/admin/backups/:name/restore', async (req, reply) => {
    const { name } = z.object({ name: z.string() }).parse(req.params);
    if (!backups.scheduleRestore(name)) return reply.code(404).send({ error: 'No encontrado' });
    log.add('warn', `Restauración programada desde ${name}. Se aplicará al reiniciar el programa.`);
    return { ok: true, message: 'La restauración se aplicará la próxima vez que se inicie el programa.' };
  });
}

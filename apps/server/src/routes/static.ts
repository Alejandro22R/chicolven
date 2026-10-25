import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';

/** Serves the TV player, the admin build and uploaded media. Everything is local (no CDNs). */
export async function staticRoutes(app: FastifyInstance): Promise<void> {
  const { playerDir, adminDir, mediaDir } = app.ctx.config;
  fs.mkdirSync(mediaDir, { recursive: true });

  await app.register(fastifyStatic, { root: playerDir, prefix: '/player/' });
  await app.register(fastifyStatic, {
    root: mediaDir,
    prefix: '/media/',
    decorateReply: false,
    // Uploaded files get random names and never change.
    maxAge: '30d',
    immutable: true,
  });

  const adminBuilt = fs.existsSync(adminDir);
  if (adminBuilt) {
    await app.register(fastifyStatic, { root: adminDir, prefix: '/admin/', decorateReply: false });
  } else {
    app.get('/admin/', async (_req, reply) =>
      reply
        .type('text/html')
        .send('<h1>Panel no compilado</h1><p>Ejecute <code>npm run build</code> o use <code>npm run dev:admin</code>.</p>'),
    );
  }
  app.get('/admin', async (_req, reply) => reply.redirect('/admin/'));
  // The TVs only need the short address: http://chicolven.local:3000 (screen picker) or …/1 (TV 1).
  app.get('/', async (_req, reply) => reply.sendFile('index.html'));
  app.get('/:n', async (req, reply) => {
    const { n } = req.params as { n: string };
    if (!/^\d{1,3}$/.test(n)) return reply.callNotFound();
    return reply.redirect(`/tv/${Number(n)}`);
  });

  app.get('/tv', async (_req, reply) => reply.sendFile('index.html'));
  app.get('/tv/', async (_req, reply) => reply.sendFile('index.html'));
  app.get('/tv/:id', async (_req, reply) => reply.sendFile('tv.html'));
}

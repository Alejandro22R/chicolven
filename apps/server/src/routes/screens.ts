import type { FastifyInstance } from 'fastify';
import { requireAdmin } from './auth.ts';
import { idParam, playlistSchema, screenSchema } from './schemas.ts';

export async function screenRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAdmin);
  const { repos, hub } = app.ctx;
  const notFound = { error: 'No encontrado' };

  app.get('/api/admin/screens', async () => ({ screens: repos.screens.list(), status: hub.status() }));

  app.post('/api/admin/screens', async (req) => {
    const screen = repos.screens.create(screenSchema.parse(req.body));
    hub.contentChanged();
    return screen;
  });

  app.put('/api/admin/screens/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const screen = repos.screens.update(id, screenSchema.partial().parse(req.body));
    if (!screen) return reply.code(404).send(notFound);
    hub.contentChanged();
    return screen;
  });

  app.delete('/api/admin/screens/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    if (!repos.screens.delete(id)) return reply.code(404).send(notFound);
    return { ok: true };
  });

  app.get('/api/admin/screens/:id/playlist', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    if (!repos.screens.get(id)) return reply.code(404).send(notFound);
    return repos.screens.playlist(id);
  });

  app.put('/api/admin/screens/:id/playlist', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    if (!repos.screens.get(id)) return reply.code(404).send(notFound);
    const items = repos.screens.setPlaylist(id, playlistSchema.parse(req.body));
    hub.contentChanged();
    return items;
  });

  /** Forces the TV(s) to reload the page (e.g. after an update). */
  app.post('/api/admin/screens/:id/reload', async (req) => {
    const { id } = idParam.parse(req.params);
    hub.reload(id);
    return { ok: true };
  });
}

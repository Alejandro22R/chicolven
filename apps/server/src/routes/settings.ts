import type { FastifyInstance } from 'fastify';
import { requireAdmin } from './auth.ts';
import { settingsSchema } from './schemas.ts';

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAdmin);
  const { repos, hub, rates } = app.ctx;

  app.get('/api/admin/settings', async () => repos.settings.getAll());

  app.put('/api/admin/settings', async (req) => {
    const patch = settingsSchema.parse(req.body);
    const settings = repos.settings.update(patch);
    rates.checkActiveChanged();
    hub.contentChanged();
    return settings;
  });
}

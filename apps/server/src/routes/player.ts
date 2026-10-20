import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { buildPlayerPayload } from '../services/priceEngine.ts';
import { idParam } from './schemas.ts';

/** Public, read-only endpoints used by the TVs. */
export async function playerRoutes(app: FastifyInstance): Promise<void> {
  const { repos, rates, hub, auth } = app.ctx;

  app.get('/api/public/screens', async () =>
    repos.screens
      .list()
      .filter((s) => s.active)
      .map((s) => ({ id: s.id, name: s.name, layout: s.layout })),
  );

  app.get('/api/player/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const screen = repos.screens.get(id);
    if (!screen || !screen.active) return reply.code(404).send({ error: 'Pantalla no encontrada' });
    reply.header('Cache-Control', 'no-store');
    return buildPlayerPayload(repos, screen, rates.current());
  });

  app.get('/ws', { websocket: true }, (socket, req) => {
    const q = z
      .object({
        role: z.enum(['player', 'admin']),
        screen: z.coerce.number().int().positive().optional(),
        token: z.string().optional(),
        preview: z.literal('1').optional(),
      })
      .safeParse(req.query);
    if (!q.success) {
      socket.close(1008, 'bad request');
      return;
    }
    if (q.data.role === 'player' && q.data.screen) {
      hub.addPlayer(socket, q.data.screen, q.data.preview === '1');
    } else if (q.data.role === 'admin' && auth.validate(q.data.token)) {
      hub.addAdmin(socket);
    } else {
      socket.close(1008, 'unauthorized');
    }
  });
}

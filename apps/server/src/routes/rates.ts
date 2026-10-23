import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseRateToE4 } from '@chicolven/shared/money';
import { requireAdmin } from './auth.ts';
import { idParam } from './schemas.ts';

export async function rateRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAdmin);
  const { repos, rates } = app.ctx;

  app.get('/api/admin/rates', async () => ({
    current: rates.current(),
    pending: repos.rates.pending(),
    history: repos.rates.history(60),
    providers: rates.status(),
    daily: rates.dailyStatus(),
  }));

  app.post('/api/admin/rates/refresh', async () => rates.refresh());

  app.post('/api/admin/rates/manual', async (req, reply) => {
    const body = z
      .object({
        rate: z.union([z.string(), z.number()]),
        effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
        note: z.string().max(200).nullable().default(null),
      })
      .parse(req.body);
    const rateE4 = parseRateToE4(body.rate);
    if (rateE4 === null || rateE4 <= 0) return reply.code(400).send({ error: 'Tasa inválida' });
    try {
      return rates.setManual(rateE4, body.effective_date, body.note);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post('/api/admin/rates/:id/confirm', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    return rates.setStatus(id, 'ok') ?? reply.code(404).send({ error: 'No encontrado' });
  });

  app.post('/api/admin/rates/:id/reject', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    return rates.setStatus(id, 'rejected') ?? reply.code(404).send({ error: 'No encontrado' });
  });
}

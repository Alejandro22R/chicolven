import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

export function readToken(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  const query = req.query as Record<string, unknown> | undefined;
  return typeof query?.token === 'string' ? query.token : null;
}

/** preHandler for admin-only routes. */
export async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!req.server.ctx.auth.validate(readToken(req))) {
    await reply.code(401).send({ error: 'Sesión no válida' });
  }
}

const pinSchema = z.string().regex(/^\d{4,8}$/, 'El PIN debe tener de 4 a 8 dígitos');

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const { auth } = app.ctx;

  app.post('/api/auth/login', async (req, reply) => {
    const { pin } = z.object({ pin: z.string().max(16) }).parse(req.body);
    if (!auth.allowAttempt(req.ip)) {
      return reply.code(429).send({ error: 'Demasiados intentos. Espere un minuto.' });
    }
    if (!auth.checkPin(pin)) {
      auth.recordFailure(req.ip);
      return reply.code(401).send({ error: 'PIN incorrecto' });
    }
    return { token: auth.createSession(), default_pin: auth.usingDefaultPin() };
  });

  app.get('/api/auth/session', { preHandler: requireAdmin }, async () => ({ ok: true, default_pin: auth.usingDefaultPin() }));

  app.post('/api/auth/logout', async (req) => {
    const token = readToken(req);
    if (token) auth.revoke(token);
    return { ok: true };
  });

  app.post('/api/auth/pin', { preHandler: requireAdmin }, async (req, reply) => {
    const body = z.object({ current: z.string(), next: pinSchema }).parse(req.body);
    if (!auth.checkPin(body.current)) return reply.code(400).send({ error: 'El PIN actual no coincide' });
    auth.setPin(body.next);
    app.ctx.log.add('info', 'PIN de administración cambiado');
    return { token: auth.createSession() };
  });
}

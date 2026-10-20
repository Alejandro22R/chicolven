import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { requireAdmin } from './auth.ts';

const ALLOWED: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

type SharpFn = (input: Buffer) => {
  rotate(): ReturnType<SharpFn>;
  resize(opts: { width: number; height: number; fit: 'inside'; withoutEnlargement: boolean }): ReturnType<SharpFn>;
  webp(opts: { quality: number }): ReturnType<SharpFn>;
  toBuffer(): Promise<Buffer>;
};

let sharpPromise: Promise<SharpFn | null> | null = null;
/** sharp is optional: without it images are stored as uploaded. */
function loadSharp(): Promise<SharpFn | null> {
  sharpPromise ??= import('sharp').then((m) => (m.default ?? m) as unknown as SharpFn).catch(() => null);
  return sharpPromise;
}

export async function mediaRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAdmin);
  const { mediaDir } = app.ctx.config;

  app.post('/api/admin/media', async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: 'No se recibió ningún archivo' });
    const ext = ALLOWED[file.mimetype];
    if (!ext) return reply.code(400).send({ error: 'Formato no permitido (use JPG, PNG, WEBP o GIF)' });
    let buffer = await file.toBuffer();
    if (file.file.truncated) return reply.code(413).send({ error: 'La imagen supera 10 MB' });

    let finalExt = ext;
    const sharp = ext === 'gif' ? null : await loadSharp();
    if (sharp) {
      try {
        // Downscale to 800 px WebP so old TVs use less memory.
        buffer = await sharp(buffer)
          .rotate()
          .resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 80 })
          .toBuffer();
        finalExt = 'webp';
      } catch {
        return reply.code(400).send({ error: 'No se pudo procesar la imagen' });
      }
    }
    fs.mkdirSync(mediaDir, { recursive: true });
    const name = `${randomBytes(12).toString('hex')}.${finalExt}`;
    fs.writeFileSync(path.join(mediaDir, name), buffer);
    return { path: name, url: `/media/${name}` };
  });
}

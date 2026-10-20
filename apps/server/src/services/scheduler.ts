import cron, { type ScheduledTask } from 'node-cron';
import { STORE } from '@chicolven/shared/brand';
import type { AppContext } from '../app.ts';

/** Background jobs: rate polling (checked every minute) and the daily backup at 23:30. */
export function startScheduler(ctx: AppContext): () => void {
  const tasks: ScheduledTask[] = [];
  const options = { timezone: STORE.timezone };

  tasks.push(
    cron.schedule(
      '* * * * *',
      () => {
        ctx.rates.tick().catch((err) => ctx.log.add('error', `Error consultando tasa: ${String(err)}`));
      },
      options,
    ),
  );

  tasks.push(
    cron.schedule(
      '30 23 * * *',
      () => {
        ctx.backups
          .create()
          .then((b) => ctx.log.add('info', `Respaldo diario creado: ${b.name}`))
          .catch((err) => ctx.log.add('error', `Error en respaldo diario: ${String(err)}`));
      },
      options,
    ),
  );

  // First rate check right after start-up.
  ctx.rates.tick().catch((err) => ctx.log.add('error', `Error consultando tasa: ${String(err)}`));

  return () => tasks.forEach((t) => t.stop());
}

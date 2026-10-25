# Chicolven Vitrina

App local offline-first de cartelería digital para la charcutería Chicolven C.A. (Venezuela).
Plan completo: `docs/PLAN.md`.

## Reglas
- Precios guardados en USD como **centavos enteros**; tasas como entero × 10.000 (`rate_e4`).
  Bs = USD × tasa BCV del día. **Nunca usar floats para dinero**: todo cálculo pasa por
  `packages/shared/src/money.ts`.
- El servidor formatea los precios; el player no hace cálculos de dinero.
- Player (`apps/player/public`) = HTML/CSS/JS **ES5** vanilla, sin dependencias ni CDNs, sin
  variables CSS ni CSS grid (navegadores de Smart TV viejos). Debe funcionar sin internet.
- La tasa tiene proveedores intercambiables (`apps/server/src/providers`) con respaldo manual;
  saltos mayores al % configurado quedan "pendientes" hasta que el admin los confirme.
- Paleta: #0A0A0A, #D7191C, #7A0C10, #FFFFFF, #8DC63F, #2F5FD0, #FFD21F.
- Panel: confirmaciones, avisos y validaciones con SweetAlert2 vía `apps/admin/src/alerts.ts`
  (no usar `alert`/`confirm` nativos); validación de formularios con `useValidation()`.
- Español en la interfaz; código y comentarios en inglés.
- Ejecutar `npm test` y `npm run typecheck` antes de dar una tarea por terminada.

## Estructura
- `apps/server` — Fastify + SQLite (better-sqlite3) + WebSocket. Entrada `src/index.ts`,
  app en `src/app.ts`, migraciones en `src/db/migrations.ts` (agregar al final, nunca editar).
- `apps/admin` — Preact + Vite, se compila a `apps/admin/dist` y se sirve en `/admin/`.
- `apps/player` — páginas de los TVs, servidas en `/tv/:id` y `/player/*`.
- `packages/shared` — dinero, tipos y marca compartidos.
- `data/` — base de datos, imágenes y respaldos (fuera de git; `CHICOLVEN_DATA` lo cambia).

## Comandos
- `npm run dev` (servidor con recarga) + `npm run dev:admin` (panel en :5173 con proxy)
- `npm run build`, `npm start`, `npm run seed` (datos de ejemplo), `npm test`, `npm run typecheck`
- `npm run empaquetar` (`-- --windows` desde Linux): carpeta `release/ChicolvenVitrina` con el .exe.
  El servidor se empaqueta en CJS sin top-level await; los módulos nativos van en `node_modules/` junto al .exe.
- Esquemas zod: crear y actualizar van separados (`entity()` en `routes/schemas.ts`); en zod 4 los
  `.default()` se aplican dentro de `.partial()` y borrarían campos.

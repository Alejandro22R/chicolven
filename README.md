# Chicolven Vitrina

Cartelería digital para **Chicolven C.A. (J-41066000-7)**: muestra productos y precios en varios
televisores, con precios guardados en dólares y convertidos a bolívares con la tasa BCV del día.
Funciona **sin internet** en un PC modesto: un solo proceso Node.js, base de datos SQLite en un
archivo y páginas web livianas para los TVs.

```
PC de la tienda ── http://IP:3000/admin/  → panel (PC o celular en el mismo WiFi)
                └─ http://IP:3000/tv/1    → televisor 1 (navegador a pantalla completa)
                   http://IP:3000/tv/2    → televisor 2 …
```

## Requisitos

- Windows 10/11 (o Linux), 2 GB de RAM o más.
- [Node.js 20 LTS o superior](https://nodejs.org/).
- Edge o Chrome para los televisores conectados por HDMI; o el navegador del Smart TV / TV Box.

## Instalación

```bash
npm install
npm run build
npm run seed      # opcional: carga productos y pantallas de ejemplo
npm start
```

La consola muestra las direcciones. Abra `http://localhost:3000/admin/` e ingrese con el
PIN **1234** (cámbielo en *Sistema*).

En Windows puede usar `scripts\iniciar.bat` (compila la primera vez y reinicia el servidor si se
cae) y `scripts\kiosko.bat 1` para abrir el TV 1 en modo kiosko. Para un segundo monitor a la
derecha: `scripts\kiosko.bat 2 1920`.

### Autoarranque en Windows

1. `Win + R` → `shell:startup`.
2. Cree accesos directos a `scripts\iniciar.bat` y a `scripts\kiosko.bat` (uno por pantalla,
   con el número como argumento).
3. Reserve una IP fija para el PC en el router, así las direcciones de los TVs no cambian.

## Uso diario

- **Cambiar un precio**: *Productos* → escriba el precio en USD → Enter. Los TVs se actualizan
  solos en uno o dos segundos.
- **Ofertas**: botón *Agregar* en la columna Oferta. El precio normal se muestra tachado.
- **Agotado**: interruptor *Agotado*; el TV muestra un sello "AGOTADO".
- **Subir/bajar varios precios**: *Productos* → *Más* → *Ajuste masivo (%)*.
- **Excel**: *Productos* → *Más* → *Exportar CSV* / *Importar CSV* (separador `;`, columnas
  `sku;nombre;categoria;precio_usd;unidad;oferta_usd;activo;descripcion`).
- **Qué muestra cada TV**: *Pantallas* → *Configurar*: diseño (cuadrícula, carrusel, lista,
  ofertas relámpago, banners), orientación, segundos por diapositiva y la lista de categorías,
  productos, ofertas o promociones en orden. Lista vacía = todas las categorías.

## Apariencia de los TVs (desde el panel)

En *Apariencia y precios*, con vista previa: tamaño del logo del encabezado y del logo de la
transición, colores de la tarjeta de producto (blanca, negra, roja, crema o personalizada),
estilo del recuadro de la tasa en el pie (rojo, negro o blanco), monedas, redondeo y marquesina.

## Si un TV se ve lento

- El player mide su propia fluidez y, si el TV no alcanza, baja solo a **calidad media**
  (mantiene transiciones y productos flotando, quita brillos, confeti y sombras) y luego a
  **baja** (solo fundidos). Lo recuerda en ese TV.
- Forzar la calidad agregando a la dirección `?calidad=alta`, `?calidad=media` o `?calidad=baja`,
  por ejemplo `http://IP:3000/tv/1?calidad=media`. Con `?calidad=alta` se vuelve a probar el
  modo completo.
- Si el PC envía 4K al televisor, configure esa salida a 1920×1080 en Windows: 4K es 4 veces
  más trabajo para el navegador.
- Con Smart TV muy viejos, un TV Box o mini PC con Chrome suele ir mucho más fluido.

## Tasa BCV

El BCV no tiene una API oficial, así que la tasa se obtiene por capas:

1. **Página del BCV** (`bcv.org.ve`): se lee el valor del dólar y la "Fecha Valor".
2. **DolarApi** (`ve.dolarapi.com`), API comunitaria que replica la tasa oficial.
3. **Fuentes JSON adicionales** configurables en *Apariencia y precios*.
4. **Tasa manual** en *Tasa BCV*, siempre disponible y sin internet.

Reglas:

- Al arrancar se usa la última tasa guardada; los TVs nunca se quedan sin precio. Sin ninguna
  tasa, muestran solo USD.
- **Consulta diaria a las 8:00 p. m.** (hora de Caracas, configurable en *Apariencia y precios*):
  si falla se reintenta cada 5 min hasta lograrlo ese día, y si el PC estaba apagado a esa hora
  se consulta al encender.
- Opcional: revisiones extra cada 30 min en horario de tienda (se pueden desactivar).
- El BCV publica hacia las 4 p. m. la tasa del día hábil siguiente. Por defecto se usa la
  **tasa vigente hoy**; la de mañana se activa sola a medianoche.
- Si una tasa nueva varía más del 15 % (configurable) se guarda como **pendiente** y no se usa
  hasta que alguien la confirme en el panel. Evita precios absurdos si la página cambia.
- Una tasa manual tiene prioridad sobre la automática **para su misma fecha**.
- Opcional: ajuste porcentual sobre la tasa y redondeo de los Bs (0,01 · 0,50 · 1 Bs …).

## Respaldo

- Respaldo automático todas las noches (23:30) en `data/backups/`, se guardan los últimos 14.
- *Sistema* → *Crear respaldo ahora* / *Descargar* (cópielo a un pendrive).
- *Restaurar* programa la restauración para el próximo inicio del programa (la base actual se
  guarda como `chicolven.db.before-restore`).

## Desarrollo

```bash
npm run dev         # servidor con recarga en :3000
npm run dev:admin   # panel con recarga en :5173 (proxy al servidor)
npm test            # pruebas (Vitest)
npm run typecheck
```

| Carpeta | Contenido |
|---|---|
| `apps/server` | Fastify, SQLite, WebSocket, servicio de tasa, motor de precios |
| `apps/admin` | Panel en Preact + Vite |
| `apps/player` | Páginas de los TVs (HTML/CSS/JS ES5, sin dependencias) |
| `packages/shared` | Utilidades de dinero (sin floats), tipos y paleta |
| `data/` | Base de datos, imágenes y respaldos (no se versiona) |

Variables de entorno: `PORT` (3000), `HOST` (0.0.0.0), `CHICOLVEN_DATA` (carpeta de datos).

## Estado respecto al plan (`docs/PLAN.md`)

| Fase | Estado |
|---|---|
| 0. Preparación | Listo: monorepo, TypeScript estricto, `CLAUDE.md`, paleta |
| 1. Núcleo de datos | Listo: esquema y migraciones SQLite (WAL), repositorios, motor de precios con pruebas |
| 2. Servicio de tasa | Listo: BCV, DolarApi, JSON personalizados y manual; validación anti-saltos; consulta programada |
| 3. API + WebSocket | Listo: CRUD, subida de imágenes (WebP 800 px), eventos en vivo |
| 4. Player | Listo: cuadrícula, carrusel, lista, ofertas, banners, ticker, reloj, vertical |
| 5. Admin | Listo: productos, categorías, pantallas con vista previa, promociones, tasa, ajustes, sistema |
| 6. Animaciones | Listo en v1; falta medir FPS en el hardware real de la tienda |
| 7. Robustez offline | Listo: caché del player, reconexión, respaldos diarios, registro de eventos |
| 8. Empaquetado | Parcial: scripts de inicio y kiosko. Falta `.exe` / servicio NSSM |
| 9. Pulido | Parcial: CSV, ajuste masivo, historial de precios y PIN listos; falta prueba en tienda |

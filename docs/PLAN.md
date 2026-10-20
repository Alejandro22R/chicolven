# Chicolven Vitrina — Plan de desarrollo

Aplicación local de cartelería digital (digital signage) para la charcutería **Chicolven C.A. (J-41066000-7)**. Proyecta productos y precios en varios televisores, con precios guardados en USD y convertidos a bolívares con la tasa BCV del día. Diseñada para funcionar **primero sin internet**, en un PC de bajos recursos.

---

## 1. Objetivos y requisitos

| # | Requisito | Decisión |
|---|-----------|----------|
| 1 | Mostrar productos con precio en varios TVs | Una pantalla "Player" por TV, cada una con su propia playlist/zona |
| 2 | Visual, animado, llamativo | Tema de marca (negro/rojo/blanco/verde/azul), transiciones CSS, tarjetas de producto grandes |
| 3 | Offline primero | Todo local: base de datos SQLite, imágenes en disco, sin CDNs |
| 4 | Tasa BCV automática | Servicio con varias fuentes + caché + tasa manual de respaldo |
| 5 | Precios en USD x tasa = Bs | Cálculo centralizado en el servidor, con redondeo configurable |
| 6 | PC de bajos recursos | Un solo proceso liviano, sin Electron, sin Docker, sin frameworks pesados |
| 7 | Editar precios fácilmente | Panel de administración web (desde el mismo PC o un celular en la red local) |

---

## 2. Arquitectura recomendada

**Un servidor local liviano + páginas web que abren los televisores en modo pantalla completa (kiosko).**

```
                ┌────────────────────────────────────────────┐
                │          PC de la tienda (servidor)        │
                │                                            │
  Admin (PC /   │  ┌──────────────┐    ┌──────────────────┐  │
  celular) ───► │  │ Panel Admin  │    │  API + WebSocket │  │
   http://      │  │ (SPA)        │◄──►│  (Fastify/Node)  │  │
   ip-local     │  └──────────────┘    └────────┬─────────┘  │
                │                               │            │
                │  ┌──────────────┐   ┌─────────▼─────────┐  │
  TV 1..N  ───► │  │ Player /tv/N │   │ SQLite + /media   │  │
  (HDMI o       │  │ (HTML+CSS)   │   └───────────────────┘  │
   Smart TV     │  └──────────────┘   ┌───────────────────┐  │
   navegador)   │                     │ Servicio de tasa  │──┼──► APIs de tasa BCV
                │                     │ (cron + caché)    │  │    (solo si hay internet)
                │                     └───────────────────┘  │
                └────────────────────────────────────────────┘
```

### Cómo se conectan los televisores (3 opciones, se pueden mezclar)

1. **TV conectado por HDMI al PC** (monitores extendidos): una ventana de navegador en modo kiosko por pantalla. Es lo más estable.
2. **Mini PC / TV Box / Chromecast con navegador** en cada TV, apuntando a `http://IP-SERVIDOR:3000/tv/2`.
3. **Smart TV con navegador integrado**: abrir la misma URL. Es la más barata, aunque depende del navegador del TV, por eso el player usa solo HTML/CSS/JS básico y compatible.

> Todo funciona por red local (router/WiFi); no hace falta internet para que los TVs se actualicen.

---

## 3. Stack tecnológico

| Capa | Tecnología | Por qué |
|------|-----------|---------|
| Runtime | **Node.js 20 LTS** | Liviano, un solo lenguaje, excelente para Claude Code |
| Lenguaje | **TypeScript** | Menos errores en cálculos de dinero |
| Servidor | **Fastify** | Muy rápido y de bajo consumo de RAM |
| Tiempo real | **WebSocket (`@fastify/websocket`)** | Un cambio de precio o tasa se refleja al instante en los TVs |
| Base de datos | **SQLite** vía `better-sqlite3` | Un solo archivo, sin servicio aparte, ideal offline |
| Validación | **Zod** | Valida datos del admin y de las APIs |
| Tareas programadas | **node-cron** | Consulta de tasa y respaldos |
| Imágenes | **sharp** (opcional) | Redimensionar fotos a 800px WebP para ahorrar RAM en los TVs |
| Player (TVs) | **HTML + CSS + JS vanilla** | Cero framework = rápido en TVs y PCs viejos; animaciones por CSS (GPU) |
| Admin | **Preact + Vite** (o Alpine.js) | Interfaz reactiva de ~10 KB, compila a archivos estáticos |
| Estilos admin | **CSS propio con variables** | Sin dependencias, tema de marca |
| Empaquetado | **`pkg` o Node SEA** + script de inicio | Un `.exe` + autoarranque con Windows |
| Pruebas | **Vitest** | Pruebas del motor de precios y de la tasa |

**Alternativa si el PC es extremadamente débil (< 2 GB RAM):** Go o Rust compilando un binario único (~15 MB) con SQLite embebido. Se mantiene el mismo diseño, solo cambia el servidor. Recomiendo Node/TypeScript por velocidad de desarrollo con Claude Code; solo cambiar si las pruebas de rendimiento lo exigen.

---

## 4. Paleta de colores (extraída del logo)

| Uso | Color | HEX aprox. |
|-----|-------|-----------|
| Fondo principal | Negro | `#0A0A0A` |
| Acento principal / ofertas | Rojo intenso | `#D7191C` |
| Rojo oscuro (degradados) | Rojo vino | `#7A0C10` |
| Texto y bordes | Blanco | `#FFFFFF` |
| Precio / destacados | Verde lima | `#8DC63F` |
| Botones / etiquetas | Azul canasta | `#2F5FD0` |
| Resaltado de oferta | Amarillo | `#FFD21F` |

**Reglas visuales:** fondo oscuro, precios gigantes en blanco o amarillo sobre franja roja, bolívares en tamaño menor debajo del USD (o viceversa, configurable), insignia en zigzag tipo "sello" del logo para etiquetas de OFERTA / NUEVO. Contraste alto para leerse a 5+ metros.

---

## 5. Modelo de datos (SQLite)

```
categories   (id, name, color, sort_order, active)
products     (id, sku, name, description, category_id, price_usd, unit,
              image_path, badge, is_offer, offer_price_usd, active,
              stock_visible, sort_order, updated_at)
screens      (id, name, layout, theme, rotation_seconds, orientation, active)
playlists    (id, screen_id, product_id | category_id | promo_id, position, duration_s)
promos       (id, title, subtitle, image_path, starts_at, ends_at)
exchange_rates (id, source, rate_ves, effective_date, fetched_at, is_manual)
settings     (key, value)   -- redondeo, símbolo, fuente preferida, logo, etc.
price_history (id, product_id, old_usd, new_usd, changed_at)
```

- **Dinero:** guardar USD en **centavos enteros** y la tasa con 4 decimales (usar enteros o `decimal.js`; nunca floats).
- La tasa activa es la más reciente con `effective_date <= hoy`; si hay una `is_manual = 1` vigente, tiene prioridad.

---

## 6. Motor de precios y tasa BCV

### Fórmula
```
precio_bs = round( precio_usd × tasa_del_día , decimales_configurados )
```
Opciones configurables: redondeo (2 decimales, al múltiplo de 0,50, hacia arriba), mostrar o no el USD, mostrar o no los Bs.

### Obtención de la tasa (hallazgo importante)
Según lo que encontré, **el BCV no ofrece una API oficial documentada**: las herramientas que circulan hacen *scraping* de la página `bcv.org.ve` o consumen APIs comunitarias que la replican. Estas fuentes pueden cambiar o caerse, por eso el diseño usa **capas de respaldo**:

1. **Fuente A — scraping directo de `https://www.bcv.org.ve/`** (propia, sin intermediarios; requiere ajustar si la web cambia; el sitio ha tenido problemas de certificado SSL, tenerlo previsto).
2. **Fuente B — API comunitaria**, por ejemplo `https://ve.dolarapi.com/v1/dolares/oficial` (JSON simple con campo `promedio`).
3. **Fuente C — otras APIs/JSON estáticos comunitarios** (p. ej. repos que publican `latest.json` o `rate.json`), configurables en `settings`.
4. **Fuente D — tasa manual** introducida en el panel (siempre disponible, funciona offline).

Se implementa como **adaptadores intercambiables** (`RateProvider`) con una misma interfaz, de modo que cambiar o agregar una fuente sea una sola archivo.

### Reglas de funcionamiento
- **Offline primero:** al arrancar, se carga la última tasa guardada; la pantalla nunca queda sin precio.
- Consulta automática: cada 30–60 min en horario de tienda y con reintentos; más una consulta al arrancar.
- **Matiz del BCV:** publica la tasa del día siguiente hacia las 4:00 p.m. (hora Caracas). Definir en ajustes si la tienda usa "tasa vigente hoy" (por defecto) o "tasa publicada más reciente".
- **Validación anti-errores:** rechazar tasas que varíen más de un % configurable (p. ej. 15 %) respecto a la anterior sin confirmación del admin, para evitar que un scraping roto ponga precios absurdos.
- **Indicadores en el admin:** fuente usada, fecha/hora de la última actualización, aviso si la tasa tiene más de 24–48 h.
- Opcional: **margen/ajuste** configurable (ej. +0 % por defecto) por si el comercio usa una tasa interna.

---

## 7. Pantallas (Player de los TVs)

**Ruta:** `/tv/:id`, a pantalla completa, sin cursor, sin barras.

### Layouts disponibles
1. **Carrusel hero:** un producto grande a la vez con foto, nombre, precio USD y Bs, fondo animado.
2. **Cuadrícula de precios (2x3, 3x3, 4x3):** muchos productos a la vez, tarjetas con la foto y precio.
3. **Lista tipo menú:** columnas de producto + precio, con la imagen del producto destacado a un lado.
4. **Ofertas relámpago:** insignia en zigzag, cuenta regresiva opcional, colores rojo/amarillo.
5. **Promo / banner:** imagen o video corto del proveedor.

### Elementos fijos
- **Cabecera:** logo de Chicolven + título de la categoría.
- **Pie:** *"Tasa BCV: Bs XXX,XX — actualizada dd/mm hh:mm"* y reloj.
- **Marquesina (ticker)** inferior con mensajes personalizados.

### Animaciones (CSS puro, aceleradas por GPU)
- Entradas con `transform`/`opacity` (deslizar, zoom suave, rebote leve en el precio).
- Parpadeo/pulso sutil en ofertas; brillo recorriendo la insignia.
- Transiciones entre diapositivas con fundido o corte lateral.
- Modo **"bajo consumo"** que desactiva efectos pesados (sombras, blur) para TVs o PCs lentos.

### Robustez
- Reconexión automática del WebSocket; si el servidor se cae, **el player sigue mostrando el último contenido** (cache en `localStorage`/Service Worker).
- Precarga de la siguiente imagen para evitar parpadeos.
- Pantalla de espera con logo si no hay contenido.

---

## 8. Panel de administración

Accesible en `http://IP-SERVIDOR:3000/admin` (con PIN/usuario; protegido solo en red local).

| Módulo | Funciones |
|--------|-----------|
| **Dashboard** | Tasa actual, fuente, estado de cada TV (conectado/desconectado), últimos cambios |
| **Productos** | CRUD, foto (con recorte automático), precio en USD, unidad (kg/pieza/100 g), oferta, activar/desactivar |
| **Edición masiva** | Tabla editable tipo hoja de cálculo, ajuste de +X % a una categoría, importar/exportar CSV/Excel |
| **Categorías** | Orden, color, ícono |
| **Pantallas** | Crear/editar cada TV, elegir layout, qué categorías/productos muestra y por cuánto tiempo, vista previa en vivo |
| **Promociones** | Banners con fechas de inicio y fin |
| **Tasa de cambio** | Tasa actual, historial, forzar actualización, tasa manual, elegir fuente, redondeo |
| **Apariencia** | Tema, tamaños, mostrar/ocultar USD o Bs, mensaje del ticker |
| **Sistema** | Respaldo/restauración de la BD, logs, versión |

Principio de UX: **cambiar un precio debe tomar menos de 10 segundos** (buscar → editar en línea → guardar → los TVs se actualizan solos).

---

## 9. Estructura del proyecto

```
chicolven-vitrina/
├─ apps/
│  ├─ server/              # Fastify + SQLite + WebSocket
│  │  ├─ src/
│  │  │  ├─ routes/        # products, screens, rates, settings, media
│  │  │  ├─ services/      # priceEngine, rateService, backup, scheduler
│  │  │  ├─ providers/     # bcvScrape.ts, dolarApi.ts, manual.ts
│  │  │  ├─ db/            # schema.sql, migrations, repositories
│  │  │  └─ ws/            # canal de eventos a los players
│  │  └─ tests/
│  ├─ admin/               # Preact + Vite (SPA)
│  └─ player/              # HTML/CSS/JS vanilla, layouts y animaciones
├─ packages/shared/        # tipos TS, constantes, utilidades de dinero
├─ data/                   # chicolven.db, media/, backups/ (fuera de git)
├─ scripts/                # instalar, iniciar, respaldo, kiosko
├─ CLAUDE.md               # guía para Claude Code (ver sección 13)
└─ README.md
```

---

## 10. Fases de desarrollo

| Fase | Entregable | Criterio de aceptación |
|------|-----------|------------------------|
| **0. Preparación** | Repo, TypeScript, lint, `CLAUDE.md`, paleta y tokens de diseño | `npm run dev` levanta el servidor vacío |
| **1. Núcleo de datos** | Esquema SQLite, migraciones, repositorios, motor de precios con pruebas | Pruebas de conversión USD→Bs y redondeo pasando |
| **2. Servicio de tasa** | Proveedores A/B/C/D, caché, cron, validación anti-saltos | Con internet obtiene tasa; sin internet usa la última guardada |
| **3. API + WebSocket** | CRUD REST, eventos en vivo, subida de imágenes | Cambiar precio por API actualiza un cliente WS al instante |
| **4. Player v1** | Layout carrusel + cuadrícula, tema de marca, pie con tasa | Un TV muestra productos con precio en Bs correcto |
| **5. Admin v1** | Productos, categorías, tasa, pantallas | Cargar 50 productos y asignarlos a 2 TVs sin tocar código |
| **6. Animaciones y layouts** | Ofertas, lista menú, banners, ticker, modo bajo consumo | Fluido (≥ 30 fps) en el hardware objetivo |
| **7. Robustez offline** | Reconexión, caché en el player, respaldos automáticos, logs | Desconectar internet y red del servidor sin que el TV quede en blanco |
| **8. Empaquetado** | Instalador/`.exe`, autoarranque, modo kiosko, guía de instalación | Reiniciar el PC y que todo arranque solo |
| **9. Pulido** | Edición masiva, CSV, historial de precios, PIN, documentación | Uso real durante una semana en la tienda |

Estimación orientativa con Claude Code: **3–5 semanas** de trabajo a medio tiempo hasta una v1 usable (fases 0–5), y 2–3 semanas más hasta la v1 completa.

---

## 11. Rendimiento y operación en equipo de bajos recursos

- Objetivo: **< 150 MB de RAM** el servidor, **< 5 % CPU** en reposo.
- Imágenes convertidas a **WebP ≤ 800 px** al subirlas; sin videos pesados por defecto.
- Navegador en modo kiosko con flags de ahorro (`--kiosk --disable-extensions --autoplay-policy=no-user-gesture-required`).
- Respaldo diario de la BD con rotación (últimos 14); copia opcional a USB.
- **Autoarranque:** servicio de Windows (NSSM) o tarea programada + script que abre los navegadores en cada pantalla.
- **IP fija** para el servidor (reserva DHCP en el router) para que las URLs de los TVs no cambien.
- Protección contra apagones: SQLite en modo WAL y escrituras transaccionales.

---

## 12. Seguridad

- Solo escucha en la red local (sin exponer al internet).
- Panel admin con PIN/contraseña con hash (argon2/bcrypt); los players son de solo lectura.
- Validación de entradas con Zod; límites de tamaño de subida; nombres de archivo saneados.
- Las APIs externas son **datos no confiables**: se valida el formato y el rango antes de usarlas.

---

## 13. Sugerencia para el `CLAUDE.md` del proyecto

```
# Chicolven Vitrina
- App local offline-first de cartelería para charcutería (Venezuela).
- Precios guardados en USD (centavos enteros); Bs = USD × tasa BCV del día.
- Nunca usar floats para dinero. Todo cálculo pasa por packages/shared/money.ts.
- Player = HTML/CSS/JS vanilla, sin dependencias ni CDNs. Debe funcionar sin internet.
- La tasa tiene proveedores intercambiables con respaldo manual.
- Paleta: #0A0A0A, #D7191C, #7A0C10, #FFFFFF, #8DC63F, #2F5FD0, #FFD21F.
- Español en la interfaz; código y comentarios en inglés.
- Ejecutar `npm test` antes de dar una tarea por terminada.
```

---

## 14. Riesgos y decisiones abiertas

| Tema | Riesgo / pregunta | Mitigación |
|------|-------------------|-----------|
| API del BCV | No hay API oficial; el scraping puede romperse | Múltiples proveedores + tasa manual + validación de rango |
| Smart TVs viejos | Navegadores limitados | Player en JS/CSS simple; alternativa con mini PC/TV box |
| ¿Cuántos TVs y de qué tipo? | Define si hace falta hardware extra | Confirmar antes de la Fase 8 |
| ¿Quién edita precios? | Define si hace falta usuarios/roles | v1 con un solo PIN; roles en el futuro |
| ¿Se mostrará inventario real? | Sincronizar con un sistema de ventas es otro proyecto | v1 manual; luego importación CSV/integración |
| Tasa del día vs. del día siguiente | Confusión de cuál aplicar | Ajuste explícito en el panel |

---

## 15. Ideas futuras

- Importar el inventario desde Excel/CSV o del sistema de facturación.
- Pantalla por estilo de horario (desayuno, almuerzo, cena).
- Modo "producto agotado" con un clic.
- App móvil/PWA del panel para cambiar precios desde el celular.
- Estadísticas de qué productos se muestran más.
- Música/anuncios de audio opcionales.

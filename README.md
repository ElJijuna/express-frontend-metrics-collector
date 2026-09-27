# express-frontend-metrics-collector

Colector de telemetría de frontend para SPAs de microfrontends servidas con Node/Express.
Captura **información del browser**, **errores** y **todos los requests `fetch`/XHR** como
`[METHOD, URL, status, start, end]`, los guarda en buffers acotados y los envía en bloques a un
backend configurable.

- Script de browser de ~4 KB gzip, sin dependencias.
- Se inyecta solo en el HTML (`<script type="module" src="/__metrics/collector.js?...">`) mediante
  un middleware de Express, y se configura por la URL del propio script.
- Pensado para ambientes no productivos (se desactiva por defecto con `NODE_ENV=production`).

## Uso rápido (Express)

```ts
import express from 'express';
import compression from 'compression';
import { metricsCollector } from 'express-frontend-metrics-collector';

const app = express();

app.use(compression()); // si se usa, SIEMPRE antes del collector
app.use(
  metricsCollector({
    client: { app: 'shell', env: 'qa' },
    onBatch: async (batch) => {
      await fetch('https://observability.internal/frontend', { method: 'POST', body: JSON.stringify(batch) });
    },
  }),
);
app.use(express.static('dist')); // index.html se sirve con el <script> ya inyectado
```

El middleware:

1. Sirve el bundle en `GET /__metrics/collector.js` (y `collector.classic.js`) con CORS.
2. Inyecta el `<script>` al inicio del `<head>` de **cualquier** respuesta HTML: `express.static`,
   `res.sendFile`, `res.send`, SSR…
3. Expone `POST /__metrics/ingest`, valida el batch y llama a `onBatch`.

### Enviar directo a un servicio externo

```ts
metricsCollector({
  onBatch: false, // no monta /ingest
  client: { app: 'shell', endpoint: 'https://collector.example.com/v1/frontend' },
});
```

### Opciones

| Opción | Default | Descripción |
| --- | --- | --- |
| `enabled` | `NODE_ENV !== 'production'` | Switch general. |
| `basePath` | `/__metrics` | Prefijo de las rutas. |
| `inject` | `true` | Inyectar el `<script>` en respuestas HTML. |
| `scriptType` | `'module'` | `'classic'` inyecta un script síncrono (ver [mejoras](#decisiones-y-mejoras)). |
| `scriptUrl` | — | URL absoluta del bundle, para servirlo desde un CDN/otro host. |
| `client` | — | Opciones del browser (tabla siguiente), se pasan por query string. |
| `onBatch` | log de una línea | Handler de cada batch, o `false` para no montar `/ingest`. |
| `maxBodySize` | `256kb` | Límite del body de `/ingest`. |

## Inclusión manual por URL

El script se configura con los query params de su propia URL, así cualquier host o microfrontend
puede incluirlo sin build:

```html
<script type="module" src="https://host/__metrics/collector.js?endpoint=/__metrics/ingest&app=shell&env=qa"></script>
```

| Query param | Default | Descripción |
| --- | --- | --- |
| `endpoint` | — (requerido) | Destino de los batches; relativo a la URL del script. |
| `app`, `env` | `unknown`, — | Para agrupar en el backend. |
| `batchSize` | `50` | Se envía al llegar a N registros. |
| `flushInterval` | `10000` | Envío periódico (ms). |
| `maxBuffer` | `1000` | Máximo en memoria por tipo; se descartan los más viejos. |
| `sampleRate` | `1` | Fracción de page loads a recolectar. |
| `fetch`, `xhr`, `errors` | `1` | Qué instrumentar. |
| `console` | `0` | Capturar también `console.error`. |
| `heartbeat` | `1` | Enviar un batch vacío cada `flushInterval` para indicar que el cliente sigue vivo. |
| `navigation` | `1` | Registrar cambios de ruta de la SPA (`pushState`, `replaceState`, `popstate`, `hashchange`). |
| `stripQuery` | `1` | Quita query/hash de las URLs (privacidad + menor cardinalidad). |
| `ignore` | — | Substrings separados por coma, p. ej. `hot-update,/health`. |
| `auto` | `1` | `0` = no iniciar solo (usar `init()` manualmente). |
| `debug` | `0` | Logs en consola. |

También se puede definir `window.__METRICS_CONFIG__ = { ... }` antes del script, o importar el cliente
desde un bundler:

```ts
import { init } from 'express-frontend-metrics-collector/client';

const collector = init(undefined, { endpoint: '/__metrics/ingest', app: 'mfe-checkout' });
collector?.recordError({ kind: 'error', message: 'Pago rechazado' }); // errores manejados
```

## Formato del batch

```jsonc
{
  "v": 2,
  "app": "shell",
  "env": "qa",
  "clientId": "4b53a17f-…",    // navegador/perfil (localStorage), compartido por sus pestañas
  "tabId": "1e56078b-…",       // pestaña (sessionStorage), sobrevive recargas
  "loadId": "77d17a2f-…",      // page load
  "seq": 3,                    // correlativo por page load; huecos = batches perdidos
  "page": "https://app/checkout",
  "visible": true,             // la pestaña estaba visible al armar el batch
  "sentAt": 1790429497892,
  "browser": { "userAgent": "…", "brands": ["Chromium 140"], "platform": "macOS", "mobile": false,
               "language": "es-PE", "timezone": "America/Lima", "screen": "1920x1080",
               "viewport": "1280x720", "pixelRatio": 2, "cores": 8, "memoryGb": 8, "connection": "4g" },
  "requests": [["GET", "https://api/users", 200, 1790429497877, 1790429497890]],
  "errors": [{ "kind": "resource", "message": "Failed to load <script>",
               "source": "https://mfe-cart/remoteEntry.js", "page": "…",
               "count": 1, "firstSeen": 1790429497880, "lastSeen": 1790429497880 }],
  "navigations": [["https://app/", 1790429490000], ["https://app/checkout", 1790429495000]],
  "tabs": ["1e56078b-…", "02df78b1-…"],  // solo la pestaña líder: pestañas abiertas del cliente
  "final": true,               // solo en el último batch del page load (cierre, recarga, salida)
  "dropped": { "requests": 0, "errors": 0 }
}
```

La primera entrada de `navigations` es la URL inicial del page load; las siguientes son cambios de
ruta de la SPA. Para saber en qué ruta ocurrió un request, se busca la última navegación anterior a
su `start`.

`status` es `0` cuando el request falló a nivel de red o fue abortado. `end` es cuando llegan los
headers (cuando resuelve la promesa de `fetch`), no cuando termina de descargarse el body.

## Clientes, pestañas y presencia

Cada batch identifica tres niveles: **cliente** (`clientId`), **pestaña** (`tabId`) y **page load**
(`loadId`). Como todo el sitio se sirve desde un único origin, las pestañas de un mismo navegador
comparten `localStorage` y la [Web Locks API](https://developer.mozilla.org/docs/Web/API/Web_Locks_API):

- Cada pestaña mantiene el lock `metrics-collector:tab:<tabId>`, que el navegador libera al cerrarla o si
  se cae. Si al iniciar ese lock ya está tomado, la pestaña es un "Duplicar pestaña" (que copia
  `sessionStorage`) y genera un `tabId` nuevo.
- Una sola pestaña por cliente toma el lock de **líder**. Solo ella envía el heartbeat, con `tabs`: la
  lista exacta de pestañas abiertas. Si se cierra, otra toma el liderazgo sola. El resto de las pestañas
  envía únicamente cuando tiene datos.
- Sin Web Locks (Safari < 15.4), cada pestaña envía su propio heartbeat y no se incluye `tabs`.

Para el backend:

- **Cliente conectado:** llegó un batch con su `clientId` hace menos de un TTL.
- **Pestañas abiertas:** el último `tabs` de su líder.
- **Pestaña cerrada o recargada:** llegó un batch con `final: true`. Si la pestaña entra al
  back/forward cache no se envía `final`, porque puede volver.

Chrome limita los timers de las pestañas en segundo plano (hasta 1 vez por minuto después de
~5 minutos). Si la líder está oculta, su heartbeat puede espaciarse hasta ~60 s, así que conviene
un TTL de al menos ~90 s.

## Decisiones y mejoras

Además de lo pedido, el colector incluye:

- **Buffers acotados**: ring buffer preasignado para requests (O(1), sin crecer) y buffer de errores
  que **deduplica** (un error en un loop de render genera 1 registro con `count`, no miles).
  Lo descartado se informa en `dropped`.
- **Requests como tuplas** en lugar de objetos, lo que da un payload y un uso de memoria menores.
- **Info del browser una sola vez** por page load (no por evento), usando User-Agent Client Hints
  cuando existen.
- **Entrega confiable**: flush por tamaño, por intervalo, y con `sendBeacon` en
  `visibilitychange`/`pagehide` (en chunks para no pasar el límite de ~64 KB). Si falla, reencola
  con backoff exponencial (hasta 5 min).
- **`text/plain`** como content-type: evita el preflight CORS y permite `sendBeacon` cross-origin.
- **Errores de carga de assets** (`<script>`, `<link>`, `<img>`), que es cómo se ve un microfrontend
  remoto caído, con la URL en `source` para atribuirlo.
- **XHR** además de `fetch` (axios y SDKs antiguos usan XHR).
- **Una sola instancia por página** aunque varios microfrontends incluyan el script.
- **No se mide a sí mismo**: usa el `fetch` original y excluye su endpoint.
- **`scriptType: 'classic'`**: los `type="module"` son siempre *deferred*, así que no ven los requests
  que ocurren antes de que corran. Un script clásico al inicio del `<head>` instrumenta `fetch`
  antes que cualquier otro script.
- **`sampleRate`** y **`stripQuery`** (por defecto) para controlar volumen y evitar enviar tokens
  o datos personales en query strings.

Ideas para siguientes pasos:

- `PerformanceObserver` de `resource`/`navigation` para tiempos de carga de cada remote.
- Web Vitals (LCP, INP, CLS) por ruta de la SPA.
- Atribución por microfrontend usando el `source` de los errores y el origen de los requests.
- Compresión con `CompressionStream('gzip')` para batches grandes.
- Detectar cambios de ruta (`history.pushState`) y registrar la ruta en cada request.

## Desarrollo

Requiere Node 24 (`.nvmrc`); ESLint 10 no soporta versiones impares de Node.

```bash
npm install
npm run check     # eslint + biome + tsc + vitest + build
npm run example   # demo en http://localhost:3000, imprime los batches en la terminal
```

Linting y formato con [super-configs](https://www.npmjs.com/package/super-configs): ESLint 10
(`createEslintConfig` type-checked + Vitest), Biome (`extends: super-configs/biome`) y tsconfig
`super-configs/tsconfig/node`. `tsc` es TypeScript 7 nativo; `typescript` (6) queda como alias para
typescript-eslint.

## Licencia

MIT

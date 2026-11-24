# Labcomp Status

Monitoreo del LABCOMP con seis paneles basados en el dashboard `Test` de New Relic: CPU promedio, series de CPU y RAM por equipo, eventos de desconexión, última CPU/RAM y conexiones por usuario/equipo. Interfaz oscura sin menú de navegación, con tipografía IBM Plex Sans, barras por equipo y un indicador circular de CPU. Las fuentes se incluyen en `docs/fonts/` junto con su licencia y se sirven desde el propio sitio. Los visitantes no necesitan una cuenta de New Relic. La página consulta la API cada 30 segundos mientras está visible; la información también depende de la demora de ingestión de New Relic.

La página existente `DonEladiou/paginachecklabit` contiene el desafío de flags de LabCIB. Este proyecto está destinado al repositorio separado `DonEladiou/dashboard-labcomp`. No reemplaza el `index.html` de la página de flags.

## Publicación temporal

```text
GitHub Pages (docs/) → Cloudflare Worker (src/worker.mjs) → New Relic NerdGraph
```

### 1. Publicar la API en Cloudflare

Se necesita una cuenta de Cloudflare y Node.js 22 o posterior en el equipo desde donde se despliega. Desde esta carpeta:

```sh
npx wrangler login
npx wrangler deploy
npx wrangler secret put NEW_RELIC_USER_KEY
```

El último comando solicita la **User API key** de New Relic de forma interactiva. No es la clave de ingesta. No la añadas al código ni al repositorio. También puedes configurar un secreto del mismo nombre desde la configuración del Worker en Cloudflare.

`wrangler.jsonc` ya declara la cuenta `3437305`, la región `US` y el origen `https://doneladiou.github.io`. Si tu cuenta es europea, cambia `NEW_RELIC_REGION` a `EU` antes de desplegar. Se admite `JP` también. La clave debe permitir consultar los datos de esa cuenta.

Copia la dirección HTTPS `workers.dev` que devuelve el despliegue. Hasta configurar una clave válida, la API responderá 503; no muestra datos de ejemplo.

Alternativa sin Wrangler: `dist/worker.mjs` contiene el Worker completo, listo para copiar en el editor de código de un Worker en Cloudflare. Configura allí `NEW_RELIC_ACCOUNT_ID=3437305`, `NEW_RELIC_REGION=US` y `ALLOWED_ORIGINS=https://doneladiou.github.io` como variables, y `NEW_RELIC_USER_KEY` como **secreto**. Después de cambiar las consultas o el backend, regenera ese archivo con `npm run build:worker`.

### 2. Conectar la página

Edita `docs/config.js`, indicando la dirección real del Worker sin la ruta `/api/dashboard`:

```js
window.LAB_CONFIG = {
  apiBaseUrl: 'https://dashboard-laboratorio-api.TU-SUBDOMINIO.workers.dev',
  refreshSeconds: 30
};
```

Este archivo solo contiene una dirección pública, nunca credenciales.

### 3. Publicar otro sitio en la misma cuenta de GitHub

1. Usa el repositorio `DonEladiou/dashboard-labcomp` y sube el contenido de esta carpeta a la rama `main`, incluidos los directorios ocultos `.github` y los demás archivos de configuración. Descomprime el ZIP antes de subir los archivos: `docs/`, `src/`, `.github/` y `package.json` deben quedar en la raíz del repositorio, sin una carpeta contenedora adicional. En el selector de archivos de macOS, `Cmd + Shift + .` muestra los archivos ocultos. Con GitHub Free, usa un repositorio público para GitHub Pages.
2. En ese repositorio, abre **Settings → Pages → Build and deployment → Source → GitHub Actions**.
3. Ejecuta **Actions → Publicar dashboard en GitHub Pages → Run workflow**, o sube un cambio dentro de `docs/` después de habilitar Pages.
4. Comprueba que termine correctamente. La dirección predeterminada será `https://doneladiou.github.io/dashboard-labcomp/` si no configuras un dominio propio.

La dirección de la página de flags seguirá siendo la misma. GitHub permite un sitio de proyecto por repositorio. La URL anterior es la esperada después de publicar, **no una afirmación de que ya esté desplegado**.

## Moverlo a una VM del laboratorio

La misma lógica de API funciona en Node y en Cloudflare. Para alojar página y API juntas en la VM:

1. Copia esta carpeta a la VM y crea `.env` a partir de `.env.example`.
2. Configura `NEW_RELIC_USER_KEY` solo en `.env`, junto con cuenta y región. En `ALLOWED_ORIGINS`, indica el origen real desde el cual abrirás la página, por ejemplo `http://192.168.1.20:8080`. Para varios orígenes, sepáralos por comas.
3. Deja `apiBaseUrl: ''` en `docs/config.js` para usar la API de la misma VM.
4. Ejecuta:

```sh
docker compose up -d --build
```

La página quedará disponible en el puerto 8080 de esa VM, sujeto a la conectividad y el firewall del laboratorio. No necesitas instalar paquetes de npm para ejecutar la aplicación. Como alternativa, con Node.js 22 o posterior:

```sh
npm start
```

Si mantienes la página en GitHub Pages y mueves solo la API a una VM, esa API debe ser alcanzable por los visitantes mediante **HTTPS**. Cambia `apiBaseUrl` a su nueva URL y conserva el origen de GitHub en `ALLOWED_ORIGINS`. Una dirección privada del laboratorio no funcionará para visitantes externos sin conectividad adicional.

## Comprobación

```sh
npm run check
npm test
```

Las pruebas usan un sustituto de New Relic: verifican límites de entrada, caché, errores, regiones y que las credenciales no aparezcan en respuestas. No prueban el acceso a la cuenta real. Valida los seis paneles con una clave válida después de desplegar.

## Funcionamiento y límites

- El selector aplica 30 minutos, 1 hora, 3 horas o 24 horas a las cuatro consultas de métricas. Las dos consultas de eventos conservan sus últimas 24 horas.
- Solo se ejecutan las seis consultas incluidas en `src/queries.mjs`. El visitante no puede enviar NRQL arbitrario.
- Los resultados se reutilizan durante 30 segundos y se deduplican las consultas simultáneas dentro del mismo proceso o isolate. En Workers este caché no es global: varios isolates o centros de datos pueden ejecutar sus propias consultas.
- Los errores de un panel se muestran como fallos; una falta de datos no se presenta como cero. Si se pierde conexión, se indica que los gráficos conservan datos anteriores, junto con la fecha de la última consulta.
- El conteo de desconexiones reproduce eventos cuyo texto coincide con las consultas originales. No es una lista de equipos actualmente desconectados.
- La página y la API son públicas. Los hostname y los nombres de usuario devueltos por las consultas se muestran a los visitantes. CORS limita qué páginas pueden leer la API desde un navegador; **no es autenticación** ni impide consultas directas a una API pública.
- No se incluyen anotaciones de despliegues o incidentes del dashboard original; esas requieren consultas adicionales. Sí se reproducen sus seis consultas de métricas y eventos.
- Se aplican las cuotas del plan de Cloudflare y los límites y condiciones de New Relic. GitHub Pages solo aloja la interfaz: la clave no puede guardarse de forma privada en JavaScript público.

## Referencias

- [GitHub Pages y sitios por proyecto](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
- [Publicar con GitHub Actions](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [Secretos de Cloudflare Workers](https://developers.cloudflare.com/workers/configuration/secrets/)
- [NerdGraph](https://docs.newrelic.com/docs/apis/nerdgraph/get-started/introduction-new-relic-nerdgraph/)
- [Límites de NRQL](https://docs.newrelic.com/docs/nrql/using-nrql/rate-limits-nrql-queries/)

La tipografía IBM Plex Sans proviene del [repositorio oficial de IBM](https://github.com/IBM/plex) y se distribuye con la licencia SIL Open Font License incluida en `docs/fonts/LICENSE.txt`.

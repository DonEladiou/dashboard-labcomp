// Generado por npm run build:worker. Sin credenciales.
// queries.mjs
// Consultas del dashboard Test entregado por el usuario.
// Solo se ejecuta este conjunto fijo; el visitante no puede enviar NRQL.
export const panels = [
  { id: 'cpu', title: 'CPU promedio', query: "SELECT average(cpuPercent) as '% CPU' FROM SystemSample" },
  { id: 'cpuSeries', title: 'CPU por equipo', query: 'SELECT average(cpuPercent) FROM SystemSample FACET hostname LIMIT MAX TIMESERIES' },
  { id: 'ramSeries', title: 'RAM por equipo', query: "SELECT average(memoryUsedBytes / memoryTotalBytes) * 100 AS 'RAM Usada (%)' FROM SystemSample FACET hostname LIMIT MAX TIMESERIES" },
  { id: 'disconnects', title: 'Desconexiones registradas', fixedRange: true, query: "SELECT count(*) AS 'Desconexiones Registradas' FROM InfrastructureEvent WHERE summary LIKE '%disconnect%' OR summary LIKE '%Disconnect%' OR summary LIKE '%shut down%' OR summary LIKE '%Shut down%' FACET hostname LIMIT MAX SINCE 1 day ago" },
  { id: 'usage', title: 'Última CPU y RAM por equipo', query: "SELECT latest(cpuPercent) AS 'CPU %', latest(memoryUsedBytes / memoryTotalBytes) * 100 AS 'RAM %' FROM SystemSample FACET hostname LIMIT MAX" },
  { id: 'logins', title: 'Conexiones a equipos', fixedRange: true, query: "SELECT count(*) AS 'Cantidad de Logins' FROM InfrastructureEvent WHERE summary LIKE 'User connected:%' AND summary NOT LIKE 'User connected: root%' AND summary NOT LIKE 'User connected: gdm-greeter%' FACET capture(summary, r'User connected: (?P<usuario>.*)'), hostname LIMIT MAX SINCE 1 day ago" }
];

export const ranges = { '30m': '30 minutes', '1h': '1 hour', '3h': '3 hours', '24h': '24 hours' };

export function graphQuery(accountId, range) {
  const fields = panels.map((panel, index) => {
    const nrql = panel.query + (panel.fixedRange ? '' : ` SINCE ${ranges[range]} ago`);
    return `w${index}: nrql(query: ${JSON.stringify(nrql)}, timeout: 10) { results }`;
  }).join('\n');
  return `{ actor { account(id: ${accountId}) { ${fields} } } }`;
}

// api.mjs

const endpoints = {
  US: 'https://api.newrelic.com/graphql',
  EU: 'https://api.eu.newrelic.com/graphql',
  JP: 'https://api.jp.newrelic.com/graphql'
};
const TTL = 30_000;

export function createDashboardAPI({ fetcher = fetch, now = Date.now } = {}) {
  // Caché y deduplicación por proceso/isolate, sin credenciales en las respuestas.
  const cache = new Map();
  const pending = new Map();
  let configuration = '';

  return async function handle(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Vary': 'Origin'
    };
    const respond = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
    if (origin && origin !== url.origin && !allowed.includes(origin)) {
      return respond({ error: 'Origen no permitido.' }, 403);
    }
    if (origin) headers['Access-Control-Allow-Origin'] = origin;
    if (url.pathname !== '/api/dashboard') return respond({ error: 'Ruta no encontrada.' }, 404);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: {
        ...headers, 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Max-Age': '600'
      } });
    }
    if (request.method !== 'GET') {
      headers.Allow = 'GET, OPTIONS';
      return respond({ error: 'Método no permitido.' }, 405);
    }
    if ([...url.searchParams.keys()].some(key => key !== 'range')) {
      return respond({ error: 'Solo se admite el parámetro range.' }, 400);
    }
    const range = url.searchParams.get('range') || '1h';
    if (!Object.hasOwn(ranges, range)) return respond({ error: 'Rango no permitido.' }, 400);
    const region = String(env.NEW_RELIC_REGION || 'US').toUpperCase();
    const accountId = String(env.NEW_RELIC_ACCOUNT_ID || '');
    if (!env.NEW_RELIC_USER_KEY || !/^[1-9]\d*$/.test(accountId) || !endpoints[region]) {
      return respond({ error: 'La conexión con New Relic todavía no está configurada.' }, 503);
    }
    // Invalida datos si cambia cuenta, región o clave en el mismo proceso.
    const nextConfiguration = `${accountId}:${region}:${env.NEW_RELIC_USER_KEY}`;
    if (configuration !== nextConfiguration) {
      configuration = nextConfiguration;
      cache.clear();
      pending.clear();
    }
    const cached = cache.get(range);
    if (cached && now() < cached.expires) return respond(cached.data);
    const taskConfiguration = configuration;
    if (!pending.has(range)) {
      const task = (async () => {
        const upstream = await fetcher(endpoints[region], {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'API-Key': env.NEW_RELIC_USER_KEY },
          body: JSON.stringify({ query: graphQuery(accountId, range) }),
          signal: AbortSignal.timeout(15_000)
        });
        if (!upstream.ok) throw new Error('upstream');
        const payload = await upstream.json();
        const account = payload?.data?.actor?.account;
        if (!account) throw new Error('account');
        const widgets = panels.map((panel, index) => {
          const alias = `w${index}`;
          const hasError = payload.errors?.some(error => !error.path || error.path.includes(alias));
          const results = account[alias]?.results;
          return {
            id: panel.id,
            title: panel.title,
            window: panel.fixedRange ? '24h' : range,
            results: !hasError && Array.isArray(results) ? results : [],
            error: hasError || !Array.isArray(results) ? 'No se pudo consultar este panel.' : null
          };
        });
        if (widgets.every(widget => widget.error)) throw new Error('queries');
        const data = { updatedAt: new Date(now()).toISOString(), range, refreshSeconds: 30, widgets };
        if (configuration === taskConfiguration) cache.set(range, { data, expires: now() + TTL });
        return data;
      })();
      pending.set(range, task);
      // Gestionar ambos resultados para que una excepción no quede sin manejar.
      task.then(() => { if (pending.get(range) === task) pending.delete(range); },
        () => { if (pending.get(range) === task) pending.delete(range); });
    }
    try { return respond(await pending.get(range)); }
    catch {
      return respond({ error: 'No se pudo consultar New Relic. Revisa la clave, los permisos, la región y las consultas del servidor.' }, 502);
    }
  };
}

// worker.mjs

const handle = createDashboardAPI();
export default { fetch(request, env) { return handle(request, env); } };

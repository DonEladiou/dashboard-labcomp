import test from 'node:test';
import assert from 'node:assert/strict';
import { createDashboardAPI } from '../src/api.mjs';
import { graphQuery } from '../src/queries.mjs';

const env = { NEW_RELIC_USER_KEY: 'test-secret-never-expose', NEW_RELIC_ACCOUNT_ID: '3437305', NEW_RELIC_REGION: 'US', ALLOWED_ORIGINS: 'https://doneladiou.github.io' };
const request = (suffix = '', options = {}) => new Request(`https://lab.example/api/dashboard${suffix}`, options);
const result = () => ({ data: { actor: { account: Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`w${i}`, { results: [{ metric: i + 1 }] }])) } } });

test('la respuesta contiene los seis paneles, sin clave ni consultas', async () => {
  let sent;
  const handle = createDashboardAPI({ fetcher: async (url, options) => {
    sent = { url, options }; return Response.json(result());
  } });
  const response = await handle(request('', { headers: { Origin: env.ALLOWED_ORIGINS } }), env);
  const text = await response.text(), data = JSON.parse(text);
  assert.equal(response.status, 200);
  assert.equal(data.widgets.length, 6);
  assert.equal(data.widgets[3].window, '24h');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), env.ALLOWED_ORIGINS);
  assert.equal(sent.url, 'https://api.newrelic.com/graphql');
  assert.equal(sent.options.headers['API-Key'], env.NEW_RELIC_USER_KEY);
  assert.ok(!text.includes(env.NEW_RELIC_USER_KEY));
  assert.ok(!text.includes('SELECT'));
});

test('deduplica solicitudes concurrentes y reutiliza resultados durante 30 segundos', async () => {
  let calls = 0, stamp = Date.now();
  const handle = createDashboardAPI({ now: () => stamp, fetcher: async () => { calls++; return Response.json(result()); } });
  await Promise.all(Array.from({ length: 20 }, () => handle(request(), env)));
  assert.equal(calls, 1);
  stamp += 29_000;
  await handle(request(), env); assert.equal(calls, 1);
  stamp += 1_001;
  await handle(request(), env); assert.equal(calls, 2);
});

test('bloquea rangos, consultas arbitrarias y orígenes no declarados antes de llamar a New Relic', async () => {
  let calls = 0;
  const handle = createDashboardAPI({ fetcher: async () => { calls++; return Response.json(result()); } });
  assert.equal((await handle(request('?range=constructor'), env)).status, 400);
  assert.equal((await handle(request('?query=SELECT%20*'), env)).status, 400);
  assert.equal((await handle(request('', { method: 'POST' }), env)).status, 405);
  assert.equal((await handle(request('', { headers: { Origin: 'https://other.example' } }), env)).status, 403);
  assert.equal(calls, 0);
});

test('un backend sin clave responde como pendiente de configuración', async () => {
  const handle = createDashboardAPI();
  assert.equal((await handle(request(), { ...env, NEW_RELIC_USER_KEY: '' })).status, 503);
});

test('los errores de autenticación no se exponen y permiten reintentar', async () => {
  let calls = 0;
  const handle = createDashboardAPI({ fetcher: async () => {
    calls++;
    if (calls === 1) return new Response(env.NEW_RELIC_USER_KEY, { status: 401 });
    return Response.json(result());
  } });
  const failed = await handle(request(), env);
  assert.equal(failed.status, 502);
  assert.ok(!(await failed.text()).includes(env.NEW_RELIC_USER_KEY));
  assert.equal((await handle(request(), env)).status, 200);
});

test('informa fallos parciales sin presentar como válido el panel fallido', async () => {
  const body = result(); body.data.actor.account.w2 = null;
  body.errors = [{ message: 'sensitive upstream information', path: ['actor', 'account', 'w2'] }];
  const handle = createDashboardAPI({ fetcher: async () => Response.json(body) });
  const response = await handle(request(), env), data = await response.json();
  assert.equal(response.status, 200);
  assert.ok(data.widgets[2].error);
  assert.equal(data.widgets[1].error, null);
  assert.ok(!JSON.stringify(data).includes('sensitive'));
});

test('la consulta conserva las ventanas de 24 horas de eventos y aplica el periodo a las métricas', () => {
  const query = graphQuery('3437305', '30m');
  assert.equal((query.match(/SINCE 30 minutes ago/g) || []).length, 4);
  assert.equal((query.match(/SINCE 1 day ago/g) || []).length, 2);
  assert.equal((query.match(/: nrql\(/g) || []).length, 6);
});

test('no reutiliza resultados de otra cuenta y soporta la región EU', async () => {
  const urls = [];
  const handle = createDashboardAPI({ fetcher: async url => { urls.push(url); return Response.json(result()); } });
  await handle(request(), env);
  await handle(request(), { ...env, NEW_RELIC_ACCOUNT_ID: '1234567', NEW_RELIC_REGION: 'EU' });
  assert.equal(urls.length, 2);
  assert.equal(urls[1], 'https://api.eu.newrelic.com/graphql');
});

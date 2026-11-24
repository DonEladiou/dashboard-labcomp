import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createDashboardAPI } from './api.mjs';

const api = createDashboardAPI();
// Lista cerrada: nunca se publican .env, código del backend o archivos arbitrarios.
const files = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/config.js': ['config.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/fonts/IBMPlexSans-Regular.woff2': ['fonts/IBMPlexSans-Regular.woff2', 'font/woff2'],
  '/fonts/IBMPlexSans-Medium.woff2': ['fonts/IBMPlexSans-Medium.woff2', 'font/woff2'],
  '/fonts/IBMPlexSans-SemiBold.woff2': ['fonts/IBMPlexSans-SemiBold.woff2', 'font/woff2'],
  '/fonts/LICENSE.txt': ['fonts/LICENSE.txt', 'text/plain; charset=utf-8']
};
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path.startsWith('/api/')) {
      const headers = new Headers();
      if (req.headers.origin) headers.set('Origin', req.headers.origin);
      const response = await api(new Request(`http://localhost${req.url}`, { method: req.method, headers }), process.env);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(await response.text());
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return;
    }
    if (!Object.hasOwn(files, path)) { res.writeHead(404); res.end('No encontrado'); return; }
    const [filename, type] = files[path];
    const body = await readFile(fileURLToPath(new URL(`../docs/${filename}`, import.meta.url)));
    res.writeHead(200, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch { res.writeHead(500); res.end('Error interno'); }
});
const port = Number(process.env.PORT || 8080);
server.listen(port, process.env.HOST || '0.0.0.0', () => console.log(`Dashboard: http://localhost:${port}`));

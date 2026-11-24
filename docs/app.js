const $ = id => document.getElementById(id);
const palette = ['#b4d68c', '#e7b86b', '#8eb9cf', '#c3a8d9', '#82c2ae', '#dc9e9e', '#d8d28d', '#a4b4cc'];
const config = window.LAB_CONFIG || {};
const refreshSeconds = Math.max(30, Number(config.refreshSeconds) || 30);
const number = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 });
const time = new Intl.DateTimeFormat('es-CL', { hour: '2-digit', minute: '2-digit' });
const ignored = new Set(['beginTimeSeconds', 'endTimeSeconds', 'beginTime', 'endTime', 'timestamp', 'facet', 'hostname', 'name']);
let activeController;
let requestVersion = 0;
let lastUpdated = null;
let isLoading = false;
let lastPayload = null;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function svgElement(tag, attrs = {}, text) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}
function numeric(value) { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
function valueOf(row) {
  const pair = Object.entries(row).find(([key, value]) => !ignored.has(key) && numeric(value) !== null);
  return pair ? pair[1] : null;
}
function facetOf(row) {
  return Array.isArray(row.facet) ? row.facet : [row.facet ?? row.hostname ?? row.name ?? 'Sin equipo'];
}
// Admite filas de NerdGraph y la estructura anidada de facetas/series.
function flatten(rows, inherited = {}) {
  return rows.flatMap(row => {
    if (!row || typeof row !== 'object') return [];
    const { timeSeries, facets, results, ...rest } = row;
    const base = { ...inherited, ...rest };
    if (Array.isArray(facets)) return flatten(facets, base);
    if (Array.isArray(timeSeries)) return flatten(timeSeries, { ...base, facet: base.facet ?? base.name });
    if (Array.isArray(results)) return flatten(results, base);
    return [base];
  });
}
function panelMessage(panel, empty) {
  const node = document.querySelector(`[data-message="${panel.id}"]`);
  const message = panel.error || (empty ? 'Sin datos para este periodo.' : '');
  node.textContent = message;
  node.classList.toggle('error', Boolean(panel.error));
  node.hidden = !message;
}
function lineChart(containerId, legendId, rows) {
  const container = $(containerId), legend = $(legendId);
  container.replaceChildren(); legend.replaceChildren();
  const groups = new Map();
  for (const row of rows) {
    const value = valueOf(row);
    const raw = row.beginTimeSeconds ?? row.beginTime ?? row.timestamp;
    const stamp = typeof raw === 'number' ? (raw > 1e12 ? raw : raw * 1000) : Date.parse(raw);
    if (value === null || !Number.isFinite(stamp)) continue;
    const name = facetOf(row).join(' · ');
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push({ stamp, value });
  }
  if (!groups.size) return false;
  const all = [...groups.values()].flat();
  const start = all.reduce((min, p) => Math.min(min, p.stamp), Infinity);
  const finish = all.reduce((max, p) => Math.max(max, p.stamp), -Infinity);
  const max = all.reduce((max, p) => Math.max(max, p.value), 100);
  const width = Math.max(260, container.clientWidth), height = 190, left = 38, right = 10, top = 14, bottom = 30;
  const x = stamp => left + (stamp - start) / (finish - start || 1) * (width - left - right);
  const y = value => height - bottom - value / max * (height - top - bottom);
  const svg = svgElement('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': `Porcentaje por equipo. ${groups.size} series; horarios según tu navegador.` });
  for (const ratio of [0, .25, .5, .75, 1]) {
    const value = max * ratio;
    svg.append(svgElement('line', { x1: left, y1: y(value), x2: width - right, y2: y(value), class: 'grid-line' }));
    svg.append(svgElement('text', { x: left - 9, y: y(value) + 5, 'text-anchor': 'end' }, integer.format(value)));
  }
  for (const [stamp, anchor] of [[start, 'start'], [(start + finish) / 2, 'middle'], [finish, 'end']]) {
    svg.append(svgElement('text', { x: x(stamp), y: height - 9, 'text-anchor': anchor }, time.format(stamp)));
  }
  let index = 0;
  for (const [name, points] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    points.sort((a, b) => a.stamp - b.stamp);
    const color = palette[index++ % palette.length];
    const line = svgElement('polyline', { points: points.map(p => `${x(p.stamp)},${y(p.value)}`).join(' '), fill: 'none', stroke: color, 'stroke-width': '2.1', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
    line.append(svgElement('title', {}, name)); svg.append(line);
    for (const point of points) {
      const dot = svgElement('circle', { cx: x(point.stamp), cy: y(point.value), r: points.length === 1 ? 3 : 2, fill: color });
      dot.append(svgElement('title', {}, `${name} · ${time.format(point.stamp)} · ${number.format(point.value)} %`)); svg.append(dot);
    }
    const item = element('span', 'legend-item');
    const swatch = element('i', 'swatch'); swatch.style.background = color; swatch.setAttribute('aria-hidden', 'true');
    item.append(swatch, document.createTextNode(name)); legend.append(item);
  }
  container.append(svg);
  return true;
}
function disconnectChart(rows) {
  const container = $('disconnect-chart'), list = $('disconnect-list');
  container.replaceChildren(); list.replaceChildren();
  const items = rows.map(row => ({ name: facetOf(row).join(' · '), value: valueOf(row) })).filter(item => item.value !== null && item.value > 0).sort((a, b) => b.value - a.value);
  const total = items.reduce((sum, item) => sum + item.value, 0);
  if (!items.length) return false;
  const svg = svgElement('svg', { viewBox: '0 0 180 180', role: 'img', 'aria-label': `${integer.format(total)} eventos de desconexión o apagado` });
  const radius = 66, circumference = 2 * Math.PI * radius;
  svg.append(svgElement('circle', { cx: 90, cy: 90, r: radius, fill: 'none', stroke: '#39424c', 'stroke-width': 10 }));
  let offset = 0;
  items.forEach((item, i) => {
    const length = item.value / total * circumference;
    const color = palette[i % palette.length];
    const arc = svgElement('circle', { cx: 90, cy: 90, r: radius, fill: 'none', stroke: color, 'stroke-width': 10, 'stroke-dasharray': `${length} ${circumference - length}`, 'stroke-dashoffset': -offset, transform: 'rotate(-90 90 90)' });
    arc.append(svgElement('title', {}, `${item.name}: ${integer.format(item.value)}`)); svg.append(arc); offset += length;
    const row = element('div', 'event-row'), label = element('span', 'event-name'), swatch = element('i', 'swatch');
    swatch.style.background = color; swatch.setAttribute('aria-hidden', 'true');
    label.append(swatch, document.createTextNode(item.name)); row.append(label, element('span', 'event-count', integer.format(item.value))); list.append(row);
  });
  svg.append(svgElement('text', { x: 90, y: 88, 'text-anchor': 'middle', class: 'donut-number' }, integer.format(total)));
  svg.append(svgElement('text', { x: 90, y: 110, 'text-anchor': 'middle', class: 'donut-label' }, 'eventos'));
  container.append(svg);
  return true;
}
function usageChart(rows) {
  const list = $('usage-list'); list.replaceChildren();
  const sorted = [...rows].sort((a, b) => facetOf(a).join('').localeCompare(facetOf(b).join('')));
  for (const row of sorted) {
    const name = facetOf(row).join(' · ');
    const item = element('div', 'usage-item'), pair = element('div', 'bar-pair');
    for (const [key, cls] of [['CPU %', ''], ['RAM %', 'ram']]) {
      const value = numeric(row[key]);
      const bar = element('div', 'bar-column'), track = element('div', 'bar-track'), fill = element('div', `bar-fill ${cls}`);
      fill.style.height = `${value === null ? 0 : Math.max(0, Math.min(100, value))}%`;
      track.append(fill); track.setAttribute('aria-hidden', 'true');
      const label = element('span', 'bar-number', value === null ? '—' : `${number.format(value)} %`);
      label.setAttribute('aria-label', `${name}, ${key}: ${value === null ? 'sin datos' : number.format(value) + ' por ciento'}`);
      bar.append(label, track); pair.append(bar);
    }
    item.append(pair, element('p', 'usage-name', name)); list.append(item);
  }
  return rows.length > 0;
}
function loginTable(rows) {
  const table = $('login-rows'); table.replaceChildren();
  rows.sort((a, b) => (valueOf(b) || 0) - (valueOf(a) || 0));
  for (const row of rows) {
    const facet = facetOf(row), value = valueOf(row), tr = element('tr');
    tr.append(element('td', '', facet[0]), element('td', '', facet[1] ?? '—'), element('td', 'number', value === null ? '—' : integer.format(value)));
    table.append(tr);
  }
  return rows.length > 0;
}
function updateCPU(value) {
  $('cpu-value').replaceChildren(document.createTextNode(value === null ? '—' : number.format(value)));
  if (value !== null) $('cpu-value').append(element('small', '', '%'));
  $('cpu-gauge').dataset.empty = String(value === null);
  $('cpu-gauge').setAttribute('aria-label', `CPU promedio: ${value === null ? 'sin datos' : number.format(value) + ' por ciento'}`);
  $('cpu-progress').style.strokeDashoffset = String(464.956 * (1 - (value === null ? 0 : Math.max(0, Math.min(100, value)) / 100)));
}
function render(payload) {
  const expected = ['cpu', 'cpuSeries', 'ramSeries', 'disconnects', 'usage', 'logins'];
  if (!Array.isArray(payload.widgets) || expected.some(id => !payload.widgets.some(panel => panel.id === id))) throw new Error('La respuesta del servidor no contiene todos los paneles.');
  for (const panel of payload.widgets) {
    const rows = flatten(Array.isArray(panel.results) ? panel.results : []);
    let hasData = false;
    if (panel.id === 'cpu') {
      const value = rows.length ? valueOf(rows[0]) : null;
      updateCPU(value);
      hasData = value !== null;
    } else if (panel.id === 'cpuSeries') hasData = lineChart('cpu-chart', 'cpu-legend', rows);
    else if (panel.id === 'ramSeries') hasData = lineChart('ram-chart', 'ram-legend', rows);
    else if (panel.id === 'disconnects') hasData = disconnectChart(rows);
    else if (panel.id === 'usage') hasData = usageChart(rows);
    else if (panel.id === 'logins') hasData = loginTable(rows);
    if (expected.includes(panel.id)) panelMessage(panel, !hasData);
  }
}
function setStatus(state, text) { $('status').dataset.state = state; $('status-text').textContent = text; }
function showNotice(text) { $('notice').textContent = text; $('notice').hidden = !text; }
function updateTimestamp() {
  if (!lastUpdated) return;
  const age = Date.now() - lastUpdated.getTime();
  $('updated').textContent = `Última consulta: ${lastUpdated.toLocaleString('es-CL')}`;
  if (age > Math.max(refreshSeconds * 2500, 90_000)) {
    setStatus('error', 'Datos desactualizados');
    showNotice('La última consulta tiene más demora de la esperada. Los gráficos muestran los últimos datos recibidos.');
  }
}
async function load() {
  const baseUrl = String(config.apiBaseUrl || '').replace(/\/$/, '');
  const onGitHubPages = location.hostname.endsWith('.github.io');
  if (!baseUrl && (onGitHubPages || location.protocol === 'file:')) {
    setStatus('pending', 'Pendiente de conexión');
    showNotice('El dashboard todavía no está conectado a su fuente de datos.');
    return;
  }
  if (baseUrl && !/^https:\/\//.test(baseUrl) && !/^http:\/\/localhost(?::\d+)?$/.test(baseUrl)) {
    setStatus('error', 'Conexión no configurada'); showNotice('La dirección de la fuente de datos no es válida.'); return;
  }
  activeController?.abort();
  const controller = new AbortController(); activeController = controller;
  const version = ++requestVersion;
  isLoading = true; $('refresh').disabled = true; $('refresh').textContent = 'Consultando…';
  if (!lastUpdated) setStatus('pending', 'Conectando con New Relic');
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(`${baseUrl}/api/dashboard?range=${encodeURIComponent($('range').value)}`, { signal: controller.signal, cache: 'no-store', credentials: 'omit' });
    const payload = await response.json();
    if (version !== requestVersion) return;
    if (!response.ok) throw new Error(payload.error || 'No se pudo obtener información.');
    const stamp = new Date(payload.updatedAt);
    if (!Number.isFinite(stamp.getTime())) throw new Error('La respuesta no contiene una fecha de consulta válida.');
    render(payload); lastPayload = payload; lastUpdated = stamp;
    const incomplete = payload.widgets.some(panel => panel.error);
    setStatus(incomplete ? 'error' : 'live', incomplete ? 'Actualización parcial' : 'Conectado a New Relic');
    showNotice(incomplete ? 'Algunos paneles no pudieron consultarse. El resto muestra los datos recibidos.' : '');
    updateTimestamp();
  } catch (error) {
    if (version !== requestVersion) return;
    setStatus('error', lastUpdated ? 'Sin conexión · datos anteriores' : 'Sin conexión');
    showNotice(error.name === 'AbortError' ? 'La consulta tardó demasiado. Se volverá a intentar automáticamente.' : error instanceof SyntaxError ? 'La fuente de datos no devolvió una respuesta válida.' : error.message || 'No se pudo conectar con la fuente de datos.');
  } finally {
    clearTimeout(timer);
    if (version === requestVersion) { isLoading = false; $('refresh').disabled = false; $('refresh').textContent = 'Actualizar'; }
  }
}
$('refresh-seconds').textContent = refreshSeconds;
$('refresh').addEventListener('click', load);
$('range').addEventListener('change', () => {
  // No deja gráficos del periodo anterior bajo el nuevo selector.
  activeController?.abort(); lastUpdated = null; lastPayload = null;
  updateCPU(null);
  for (const id of ['cpu-chart', 'cpu-legend', 'ram-chart', 'ram-legend', 'disconnect-chart', 'disconnect-list', 'usage-list', 'login-rows']) $(id).replaceChildren();
  for (const message of document.querySelectorAll('[data-message]')) { message.textContent = 'Consultando periodo…'; message.hidden = false; message.classList.remove('error'); }
  $('updated').textContent = 'Consultando periodo seleccionado';
  load();
});
setInterval(() => { if (!document.hidden && !isLoading) load(); }, refreshSeconds * 1000);
setInterval(updateTimestamp, 10_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && !isLoading) load(); });
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (lastPayload) render(lastPayload); }, 120);
});
load();

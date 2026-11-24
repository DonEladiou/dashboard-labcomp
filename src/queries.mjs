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

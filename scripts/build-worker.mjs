import { mkdir, readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const chunks = [];
for (const filename of ['queries.mjs', 'api.mjs', 'worker.mjs']) {
  const source = await readFile(new URL(`src/${filename}`, root), 'utf8');
  const standalone = source.replace(/^import \{[^\n]+\} from '\.\/[^']+';\n/gm, '');
  if (/^import /m.test(standalone)) throw new Error(`Importación inesperada en ${filename}; revisa el empaquetado.`);
  chunks.push(`// ${filename}\n${standalone}`);
}
await mkdir(new URL('dist/', root), { recursive: true });
await writeFile(new URL('dist/worker.mjs', root), '// Generado por npm run build:worker. Sin credenciales.\n' + chunks.join('\n'));
console.log('Worker independiente listo: dist/worker.mjs');

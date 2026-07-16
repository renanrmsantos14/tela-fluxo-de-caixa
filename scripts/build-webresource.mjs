import { readFile, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(exec);
const root = fileURLToPath(new URL('..', import.meta.url));
const dist = new URL('../dist/', import.meta.url);
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

await rm(dist, { recursive: true, force: true });
await run('npx vite build', { cwd: root });
const files = await readdir(new URL('assets/', dist));
const js = files.find((file) => file.endsWith('.js'));
const css = files.find((file) => file.endsWith('.css'));
if (!js || !css) throw new Error('Build Vite não gerou JS e CSS esperados.');
const [script, styles] = await Promise.all([
  readFile(new URL(`assets/${js}`, dist), 'utf8'),
  readFile(new URL(`assets/${css}`, dist), 'utf8')
]);
const build = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const html = `<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Fluxo de Caixa | Betinhos</title><style>${styles}</style></head><body><div id="root"></div><script>window.__APP_BUILD_INFO=${JSON.stringify({ version: packageJson.version, builtAt: build })};</script><script type="module">${script}</script></body></html>`;
await mkdir(dist, { recursive: true });
await writeFile(new URL('cr40f_TelaFluxoDeCaixa.html', dist), html, 'utf8');
console.log(`[build] dist/cr40f_TelaFluxoDeCaixa.html (${Buffer.byteLength(html)} bytes)`);

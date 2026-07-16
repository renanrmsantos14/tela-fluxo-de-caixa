import { readFile, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { basename, extname } from 'node:path';

const run = promisify(exec);
const root = fileURLToPath(new URL('..', import.meta.url));
const dist = new URL('../dist/', import.meta.url);
const buildTempName = `.build-webresource-temp-${process.pid}`;
const buildTemp = new URL(`../${buildTempName}/`, import.meta.url);
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

const buildTempPath = fileURLToPath(buildTemp);
if (!buildTempPath.startsWith(root)) throw new Error('Diretório temporário fora do workspace.');
await run('npx vite build', {
  cwd: root,
  env: { ...process.env, VITE_BUILD_OUT_DIR: `${buildTempName}/assets` },
});
const files = await readdir(new URL('assets/', buildTemp));
const js = files.find((file) => file.endsWith('.js'));
const css = files.find((file) => file.endsWith('.css'));
if (!js || !css) throw new Error('Build Vite não gerou JS e CSS esperados.');
const [script, styles] = await Promise.all([
  readFile(new URL(`assets/${js}`, buildTemp), 'utf8'),
  readFile(new URL(`assets/${css}`, buildTemp), 'utf8')
]);
const fontMime = { '.woff2': 'font/woff2', '.woff': 'font/woff' };
let embeddedStyles = styles;
for (const match of styles.matchAll(/url\((['"]?)([^'")]+)\1\)/g)) {
  const original = match[0];
  const source = match[2];
  const file = basename(source);
  const mime = fontMime[extname(file)];
  if (!mime || source.startsWith('data:') || source.startsWith('http')) continue;
  const encoded = (await readFile(new URL(`assets/${file}`, buildTemp))).toString('base64');
  embeddedStyles = embeddedStyles.replace(original, `url("data:${mime};base64,${encoded}")`);
}
const build = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const html = `<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Fluxo de Caixa | Betinhos</title><style>${embeddedStyles}</style></head><body><div id="root"></div><script>window.__APP_BUILD_INFO=${JSON.stringify({ version: packageJson.version, builtAt: build })};</script><script type="module">${script}</script></body></html>`;
await mkdir(dist, { recursive: true });
const finalFile = new URL('cr40f_TelaFluxoDeCaixa.html', dist);
const temporaryFile = new URL(`cr40f_TelaFluxoDeCaixa.html.tmp-${process.pid}`, dist);
await writeFile(temporaryFile, html, 'utf8');
await rename(temporaryFile, finalFile);
await rm(buildTemp, { recursive: true, force: true });
console.log(`[build] dist/cr40f_TelaFluxoDeCaixa.html (${Buffer.byteLength(html)} bytes)`);

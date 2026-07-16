import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../dist/cr40f_TelaFluxoDeCaixa.html', import.meta.url), 'utf8');
const checks = [
  ['root React', '<div id="root"></div>'],
  ['build info', 'window.__APP_BUILD_INFO'],
  ['sem assets externos', 'src="/assets/'],
  ['sem gradiente', 'linear-gradient']
];
for (const [name, value] of checks) {
  const forbidden = name.startsWith('sem ');
  if (forbidden ? html.includes(value) : !html.includes(value)) throw new Error(`Falha: ${name}`);
}
console.log('[verify] webresource único validado');

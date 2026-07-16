import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8').then((text) => text.toLowerCase());
const tokens = await readFile(new URL('../../design-tokens.css', import.meta.url), 'utf8').then((text) => text.toLowerCase());
if (!css.includes('@import "../../design-tokens.css"')) throw new Error('Design system ausente: import do design system Pai');
const assertions = [
  ['tokens de canvas', '--bt-color-canvas' ],
  ['superfície neutra', '#fcfcfb'],
  ['redução de movimento', 'prefers-reduced-motion']
];
for (const [name, value] of assertions) if (!tokens.includes(value)) throw new Error(`Design system ausente: ${name}`);
if (css.includes(':root { --bt-color-brand:')) throw new Error('Tokens do Pai foram copiados localmente em vez de importados.');
if (css.includes('gradient(') || css.includes('prefers-color-scheme: dark')) throw new Error('Dark mode ou gradiente não autorizado.');
console.log('[design] tokens essenciais, light-only e motion reduzido validados');

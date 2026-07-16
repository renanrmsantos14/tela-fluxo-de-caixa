import { readFile, writeFile } from 'node:fs/promises';

const packageUrl = new URL('../package.json', import.meta.url);
const lockUrl = new URL('../package-lock.json', import.meta.url);
const pkg = JSON.parse(await readFile(packageUrl, 'utf8'));
const [major, minor, patch] = pkg.version.split('.').map(Number);
if (![major, minor, patch].every(Number.isInteger)) throw new Error(`Versão inválida: ${pkg.version}`);
pkg.version = `${major}.${minor}.${patch + 1}`;
const lock = JSON.parse(await readFile(lockUrl, 'utf8'));
lock.version = pkg.version;
if (lock.packages?.['']) lock.packages[''].version = pkg.version;
await Promise.all([
  writeFile(packageUrl, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8'),
  writeFile(lockUrl, `${JSON.stringify(lock, null, 2)}\n`, 'utf8')
]);
console.log(`[version] v${pkg.version} ${new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(new Date())}`);

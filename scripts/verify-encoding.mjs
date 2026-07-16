import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const roots = ['src', 'scripts', 'automation', 'tests'];
const rootFiles = ['README.md', 'index.html', 'package.json', 'tsconfig.json', 'vite.config.ts', '.env.example'];
const textExtensions = new Set(['.css', '.html', '.js', '.json', '.md', '.mjs', '.ps1', '.ts', '.tsx']);
const decoder = new TextDecoder('utf-8', { fatal: true });
const mojibake = /Ã[¡-¿]|Â[^\s]|â(?:€|€“|€”|€™|€œ|€)|ðŸ|�/u;

async function collect(directory) {
  const files = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) files.push(...await collect(path));
    else if (textExtensions.has(extname(item.name).toLowerCase())) files.push(path);
  }
  return files;
}

const files = [...rootFiles, ...(await Promise.all(roots.map(collect))).flat()];
for (const file of files) {
  const text = decoder.decode(await readFile(file));
  const match = file.endsWith('verify-encoding.mjs') ? null : text.match(mojibake);
  if (match) throw new Error(`[encoding] mojibake encontrado em ${file}: ${JSON.stringify(match[0])}`);
}
console.log(`[encoding] UTF-8 estrito e sem mojibake em ${files.length} arquivos: ok`);

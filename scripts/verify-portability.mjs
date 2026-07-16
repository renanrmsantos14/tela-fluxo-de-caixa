import { readFile } from 'node:fs/promises';

const files = [
  'src/lib/runtime.ts',
  'src/lib/dataverse.ts',
  'scripts/run-dataverse-script.mjs',
  'dist/cr40f_TelaFluxoDeCaixa.html',
];
const forbidden = [/org23b93544/i, /new_sharedcommondataserviceforapps_5696d/i, /new_sharedoffice365_f87d5/i];
for (const file of files) {
  const content = await readFile(file, 'utf8');
  for (const pattern of forbidden) {
    if (pattern.test(content)) throw new Error(`[portability] valor específico de DEV encontrado em ${file}: ${pattern}`);
  }
}
console.log('[portability] app e scripts sem vínculo com uma organização específica: ok');

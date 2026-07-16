import { readFile } from 'node:fs/promises';

const files = [
  'src/lib/runtime.ts',
  'src/lib/dataverse.ts',
  'scripts/run-dataverse-script.mjs',
  'automation/fluxo-caixa-diario.json',
  'dist/cr40f_TelaFluxoDeCaixa.html',
];
const contents = await Promise.all(files.map(async (file) => [file, await readFile(file, 'utf8')]));
const forbidden = [
  /org23b93544/i,
  /new_sharedcommondataserviceforapps_5696d/i,
  /new_sharedoffice365_f87d5/i,
];
for (const [file, content] of contents) {
  for (const pattern of forbidden) {
    if (pattern.test(content)) throw new Error(`[portability] valor específico de DEV encontrado em ${file}: ${pattern}`);
  }
}
const flow = JSON.parse(contents.find(([file]) => file.endsWith('.json'))[1]);
const references = flow.properties.connectionReferences;
if (references.shared_commondataserviceforapps.connection.connectionReferenceLogicalName !== '__DATAVERSE_CONNECTION_REFERENCE__') {
  throw new Error('[portability] template do Flow contém connection reference Dataverse fixa.');
}
if (references.shared_office365.connection.connectionReferenceLogicalName !== '__OUTLOOK_CONNECTION_REFERENCE__') {
  throw new Error('[portability] template do Flow contém connection reference Outlook fixa.');
}
console.log('[portability] app, scripts e Flow sem vínculo com a organização DEV: ok');

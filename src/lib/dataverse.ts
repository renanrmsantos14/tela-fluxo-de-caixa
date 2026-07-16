import type { CashflowEntry, FinanceReference, MetadataAttribute, MetadataEntity, OfxImportResult, OrderMapping, RuntimeContext } from '../types';
import { generateRecurrenceDates } from './cashflow';

const entrySet = 'cr40f_fluxocaixalancamentos';

export const financeSets = {
  accounts: 'cr40f_fluxocaixacontas', categories: 'cr40f_fluxocaixacategorias',
  counterparties: 'cr40f_fluxocaixacontrapartes',
  recurrences: 'cr40f_fluxocaixarecorrencias', rules: 'cr40f_fluxocaixaregras',
  holidays: 'cr40f_fluxocaixaferiados', settings: 'cr40f_fluxocaixaconfiguracaos',
  events: 'cr40f_fluxocaixaeventos', imports: 'cr40f_fluxocaixaimportacaos'
} as const;

const financePrimaryIds: Record<string, string> = {
  [financeSets.accounts]: 'cr40f_fluxocaixacontaid',
  [financeSets.categories]: 'cr40f_fluxocaixacategoriaid',
  [financeSets.counterparties]: 'cr40f_fluxocaixacontraparteid',
  [financeSets.recurrences]: 'cr40f_fluxocaixarecorrenciaid',
  [financeSets.rules]: 'cr40f_fluxocaixaregraid',
  [financeSets.holidays]: 'cr40f_fluxocaixaferiadoid',
  [financeSets.settings]: 'cr40f_fluxocaixaconfiguracaoid',
  [financeSets.events]: 'cr40f_fluxocaixaeventoid',
  [financeSets.imports]: 'cr40f_fluxocaixaimportacaoid',
};

function payload(entry: CashflowEntry): Record<string, unknown> {
  const body: Record<string, unknown> = {
    cr40f_name: entry.description,
    cr40f_data: entry.date,
    cr40f_valor: entry.amount,
    cr40f_categoria: entry.category,
    cr40f_grupo: entry.group,
    cr40f_origem: entry.source,
    cr40f_tipo: entry.kind,
    cr40f_natureza: entry.nature,
    cr40f_status: entry.status,
    cr40f_descricaooriginal: entry.originalDescription,
    cr40f_dataoriginal: entry.originalDate,
    cr40f_fitid: entry.fitId
    ,cr40f_chavetransacao: entry.transactionKey
    ,cr40f_conta: entry.account
    ,cr40f_contraparte: entry.counterparty
    ,cr40f_origemid: entry.originId
    ,cr40f_conciliadocomid: entry.reconciledWithId
  };
  if (entry.accountId) body['cr40f_ContaRef@odata.bind'] = `/cr40f_fluxocaixacontas(${entry.accountId})`;
  if (entry.categoryId) body['cr40f_CategoriaRef@odata.bind'] = `/cr40f_fluxocaixacategorias(${entry.categoryId})`;
  if (entry.counterpartyId) body['cr40f_ContraparteRef@odata.bind'] = `/cr40f_fluxocaixacontrapartes(${entry.counterpartyId})`;
  if (entry.importId) body['cr40f_ImportacaoRef@odata.bind'] = `/cr40f_fluxocaixaimportacaos(${entry.importId})`;
  if (entry.reconciledWithId) body['cr40f_ConciliadoCom@odata.bind'] = `/cr40f_fluxocaixalancamentos(${entry.reconciledWithId})`;
  return body;
}

function odata(value: string): string { return value.replace(/'/g, "''"); }

async function directRequest(context: RuntimeContext, path: string, options?: RequestInit): Promise<Response> {
  const headers = new Headers(options?.headers);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${context.clientUrl}/api/data/v9.2/${path}`, {
    ...options,
    credentials: 'same-origin',
    headers
  });
  if (!response.ok) throw new Error(`Dataverse respondeu ${response.status}.`);
  return response;
}

export async function saveEntry(context: RuntimeContext, entry: CashflowEntry): Promise<string> {
  if (context.mode === 'mock') return entry.id;
  if (context.mode === 'xrm' && context.xrm?.WebApi) return (await context.xrm.WebApi.createRecord('cr40f_fluxocaixalancamento', payload(entry))).id;
  const response = await directRequest(context, entrySet, { method: 'POST', body: JSON.stringify(payload(entry)) });
  const entity = response.headers.get('OData-EntityId');
  return entity?.match(/\(([0-9a-f-]{36})\)$/i)?.[1] ?? entry.id;
}

export async function listReferences(context: RuntimeContext, setName: string, select: string): Promise<FinanceReference[]> {
  if (context.mode === 'mock') return [];
  const primaryId = financePrimaryIds[setName];
  if (!primaryId) throw new Error(`Tabela mestre sem chave primária mapeada: ${setName}`);
  const result = await directRequest(context, `${setName}?$select=${select}&$orderby=createdon desc`).then((response) => response.json()) as { value: Record<string, unknown>[] };
  return result.value.map((record) => ({ id: String(record[primaryId] ?? ''), name: String(record.cr40f_name ?? ''), group: record.cr40f_grupo as string | undefined, nature: record.cr40f_natureza as FinanceReference['nature'], bank: record.cr40f_banco as string | undefined, identifier: record.cr40f_identificador as string | undefined, document: record.cr40f_documento as string | undefined, amount: Number(record.cr40f_valor ?? 0), category: record.cr40f_categoria as string | undefined, categoryId: (record._cr40f_categoriaref_value ?? record._cr40f_categoriaopref_value) as string | undefined, counterpartyId: record._cr40f_contraparteref_value as string | undefined, frequency: record.cr40f_frequencia as FinanceReference['frequency'], businessDayPolicy: record.cr40f_ajustevencimento as FinanceReference['businessDayPolicy'], intervalDays: Number(record.cr40f_intervalodias ?? 0) || undefined, start: String(record.cr40f_inicio ?? '').slice(0, 10) || undefined, end: String(record.cr40f_fim ?? '').slice(0, 10) || undefined, date: String(record.cr40f_data ?? '').slice(0, 10) || undefined, expression: record.cr40f_expressao as string | undefined, recipients: record.cr40f_destinatariosalerta as string | undefined, action: record.cr40f_acao as string | undefined, detail: record.cr40f_detalhe as string | undefined, entity: record.cr40f_entidadeop as string | undefined, entitySet: record.cr40f_entitysetop as string | undefined, idField: record.cr40f_campoidop as string | undefined, nameField: record.cr40f_camponomeop as string | undefined, amountField: record.cr40f_campovalorop as string | undefined, dateField: record.cr40f_campodataop as string | undefined, statusField: record.cr40f_campostatusop as string | undefined, activeStatusValue: record.cr40f_valorativoop as string | undefined, counterpartyField: record.cr40f_campocontraparteop as string | undefined }));
}

export async function saveReference(context: RuntimeContext, setName: string, body: Record<string, unknown>, id?: string): Promise<string> {
  if (context.mode === 'mock') return id ?? crypto.randomUUID();
  if (!context.clientUrl) throw new Error('Contexto Dataverse sem URL.');
  if (id) { await directRequest(context, `${setName}(${id})`, { method: 'PATCH', headers: { 'If-Match': '*' }, body: JSON.stringify(body) }); return id; }
  const response = await directRequest(context, setName, { method: 'POST', body: JSON.stringify(body) });
  return response.headers.get('OData-EntityId')?.match(/\(([0-9a-f-]{36})\)$/i)?.[1] ?? crypto.randomUUID();
}

export async function patchEntry(context: RuntimeContext, entry: CashflowEntry, changes: Partial<CashflowEntry>): Promise<void> {
  if (context.mode === 'mock') return;
  await directRequest(context, `${entrySet}(${entry.id})`, { method: 'PATCH', headers: { 'If-Match': entry.etag ?? '*' }, body: JSON.stringify(payload({ ...entry, ...changes })) });
}

export async function reverseImport(context: RuntimeContext, importId: string): Promise<void> {
  if (context.mode === 'mock') return;
  const filter = encodeURIComponent(`cr40f_importacaoid eq '${odata(importId)}'`);
  const records = await directRequest(context, `${entrySet}?$select=cr40f_fluxocaixalancamentoid,_cr40f_conciliadocom_value&$filter=${filter}`).then((response) => response.json()) as { value: Array<{ cr40f_fluxocaixalancamentoid: string; _cr40f_conciliadocom_value?: string }> };
  const importedIds = records.value.map((record) => record.cr40f_fluxocaixalancamentoid);
  const counterpartIds = [...new Set(records.value
    .map((record) => record._cr40f_conciliadocom_value)
    .filter((id): id is string => typeof id === 'string')
    .filter((id) => !importedIds.includes(id)))];
  const request = buildReverseBatch(importId, importedIds, counterpartIds);
  const response = await fetch(`${context.clientUrl}/api/data/v9.2/$batch`, { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json', 'OData-MaxVersion': '4.0', 'OData-Version': '4.0', 'Content-Type': `multipart/mixed; boundary="${request.batch}"` }, body: request.body });
  const text = await response.text();
  if (!response.ok || /HTTP\/1\.1 [45]\d\d/.test(text)) throw new Error(`Reversão atômica rejeitada pelo Dataverse.${batchErrorDetail(text)}`);
}

export async function audit(context: RuntimeContext, action: string, detail: string): Promise<void> {
  await saveReference(context, financeSets.events, { cr40f_name: action, cr40f_acao: action, cr40f_detalhe: detail, cr40f_data: new Date().toISOString().slice(0, 10) });
}

export async function importExists(context: RuntimeContext, fingerprint: string): Promise<boolean> {
  if (context.mode === 'mock') return false;
  const query = `?$select=cr40f_fluxocaixaimportacaoid&$top=1&$filter=cr40f_fingerprint eq '${odata(fingerprint)}'`;
  if (context.mode === 'xrm' && context.xrm?.WebApi) return (await context.xrm.WebApi.retrieveMultipleRecords('cr40f_fluxocaixaimportacao', query)).entities.length > 0;
  return (await directRequest(context, `cr40f_fluxocaixaimportacaos${query}`).then((response) => response.json()) as { value: unknown[] }).value.length > 0;
}

async function transactionExists(context: RuntimeContext, keys: string[]): Promise<boolean> {
  if (context.mode === 'mock' || !keys.length) return false;
  for (let index = 0; index < keys.length; index += 25) {
    const filter = keys.slice(index, index + 25).map((key) => `cr40f_chavetransacao eq '${odata(key)}'`).join(' or ');
    const query = `?$select=cr40f_fluxocaixalancamentoid&$top=1&$filter=${encodeURIComponent(filter)}`;
    const found = context.mode === 'xrm' && context.xrm?.WebApi
      ? (await context.xrm.WebApi.retrieveMultipleRecords('cr40f_fluxocaixalancamento', query)).entities.length > 0
      : (await directRequest(context, `${entrySet}${query}`).then((response) => response.json()) as { value: unknown[] }).value.length > 0;
    if (found) return true;
  }
  return false;
}

async function createImport(context: RuntimeContext, result: OfxImportResult, account: string, accountId: string): Promise<string> {
  const body = { cr40f_name: `OFX ${new Date().toISOString().slice(0, 10)}`, cr40f_fingerprint: result.fingerprint, cr40f_conta: account, cr40f_status: 'processing', 'cr40f_ContaRef@odata.bind': `/cr40f_fluxocaixacontas(${accountId})` };
  const response = await directRequest(context, 'cr40f_fluxocaixaimportacaos', { method: 'POST', body: JSON.stringify(body) });
  const entity = response.headers.get('OData-EntityId');
  const id = entity?.match(/\(([0-9a-f-]{36})\)$/i)?.[1];
  if (!id) throw new Error('Dataverse não retornou o identificador da importação OFX.');
  return id;
}

async function uploadOriginalFile(context: RuntimeContext, importId: string, file: File): Promise<void> {
  const response = await fetch(`${context.clientUrl}/api/data/v9.2/cr40f_fluxocaixaimportacaos(${importId})/cr40f_arquivoofx`, { method: 'PATCH', credentials: 'same-origin', headers: { Accept: 'application/json', 'OData-MaxVersion': '4.0', 'OData-Version': '4.0', 'If-None-Match': 'null', 'Content-Type': 'application/octet-stream', 'x-ms-file-name': file.name }, body: await file.arrayBuffer() });
  if (!response.ok) throw new Error(`Falha ao guardar OFX original (${response.status}).`);
}

export function buildOfxBatch(importId: string, entries: CashflowEntry[], batch = `batch_${crypto.randomUUID().replaceAll('-', '')}`, changeSet = `changeset_${crypto.randomUUID().replaceAll('-', '')}`): { batch: string; body: string } {
  const lines = [`--${batch}`, `Content-Type: multipart/mixed; boundary="${changeSet}"`, ''];
  for (const [index, entry] of entries.entries()) {
    lines.push(`--${changeSet}`, 'Content-Type: application/http', 'Content-Transfer-Encoding: binary', `Content-ID: ${index + 1}`, '', `POST /api/data/v9.2/${entrySet} HTTP/1.1`, 'Content-Type: application/json;type=entry', '', JSON.stringify({ ...payload(entry), cr40f_importacaoid: importId, 'cr40f_ImportacaoRef@odata.bind': `/cr40f_fluxocaixaimportacaos(${importId})` }), '');
  }
  lines.push(`--${changeSet}`, 'Content-Type: application/http', 'Content-Transfer-Encoding: binary', `Content-ID: ${entries.length + 1}`, '', `PATCH /api/data/v9.2/cr40f_fluxocaixaimportacaos(${importId}) HTTP/1.1`, 'Content-Type: application/json;type=entry', '', JSON.stringify({ cr40f_status: 'imported' }), '', `--${changeSet}--`, `--${batch}--`, '');
  return { batch, body: lines.join('\r\n') };
}

export function buildReverseBatch(importId: string, entryIds: string[], counterpartIds: string[] = [], batch = `batch_${crypto.randomUUID().replaceAll('-', '')}`, changeSet = `changeset_${crypto.randomUUID().replaceAll('-', '')}`): { batch: string; body: string } {
  const lines = [`--${batch}`, `Content-Type: multipart/mixed; boundary="${changeSet}"`, ''];
  let contentId = 1;
  for (const id of entryIds) {
    lines.push(`--${changeSet}`, 'Content-Type: application/http', 'Content-Transfer-Encoding: binary', `Content-ID: ${contentId++}`, '', `PATCH /api/data/v9.2/${entrySet}(${id}) HTTP/1.1`, 'Content-Type: application/json;type=entry', '', JSON.stringify({ cr40f_status: 'reversed', cr40f_conciliadocomid: null, 'cr40f_ConciliadoCom@odata.bind': null }), '');
  }
  for (const id of counterpartIds) {
    lines.push(`--${changeSet}`, 'Content-Type: application/http', 'Content-Transfer-Encoding: binary', `Content-ID: ${contentId++}`, '', `PATCH /api/data/v9.2/${entrySet}(${id}) HTTP/1.1`, 'Content-Type: application/json;type=entry', '', JSON.stringify({ cr40f_status: 'open', cr40f_conciliadocomid: null, 'cr40f_ConciliadoCom@odata.bind': null }), '');
  }
  lines.push(`--${changeSet}`, 'Content-Type: application/http', 'Content-Transfer-Encoding: binary', `Content-ID: ${contentId}`, '', `PATCH /api/data/v9.2/${financeSets.imports}(${importId}) HTTP/1.1`, 'Content-Type: application/json;type=entry', '', JSON.stringify({ cr40f_status: 'reversed' }), '', `--${changeSet}--`, `--${batch}--`, '');
  return { batch, body: lines.join('\r\n') };
}

export function buildReconciliationBatch(actual: CashflowEntry, forecast: CashflowEntry, batch = `batch_${crypto.randomUUID().replaceAll('-', '')}`, changeSet = `changeset_${crypto.randomUUID().replaceAll('-', '')}`): { batch: string; body: string } {
  const lines = [`--${batch}`, `Content-Type: multipart/mixed;boundary=${changeSet}`, ''];
  for (const [index, [entry, counterpart]] of ([[actual, forecast], [forecast, actual]] as const).entries()) {
    lines.push(`--${changeSet}`, 'Content-Type: application/http', 'Content-Transfer-Encoding: binary', `Content-ID: ${index + 1}`, '', `PATCH /api/data/v9.2/${entrySet}(${entry.id}) HTTP/1.1`, 'Content-Type: application/json', `If-Match: ${entry.etag}`, '', JSON.stringify({ cr40f_status: 'reconciled', cr40f_conciliadocomid: counterpart.id, 'cr40f_ConciliadoCom@odata.bind': `/cr40f_fluxocaixalancamentos(${counterpart.id})` }), '');
  }
  lines.push(`--${changeSet}--`, `--${batch}--`, '');
  return { batch, body: lines.join('\r\n') };
}

function batchErrorDetail(text: string): string {
  try { const json = JSON.parse(text) as { error?: { message?: string } }; return json.error?.message ? ` Detalhe Dataverse: ${json.error.message}` : ''; }
  catch { const match = text.match(/"message"\s*:\s*"([^"]+)"|<title>([^<]+)<\/title>/i); return match ? ` Detalhe Dataverse: ${match[1] ?? match[2]}` : ''; }
}

async function saveBatch(context: RuntimeContext, importId: string, entries: CashflowEntry[]): Promise<void> {
  const request = buildOfxBatch(importId, entries);
  const response = await fetch(`${context.clientUrl}/api/data/v9.2/$batch`, { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json', 'OData-MaxVersion': '4.0', 'OData-Version': '4.0', 'Content-Type': `multipart/mixed; boundary="${request.batch}"` }, body: request.body });
  const text = await response.text();
  if (!response.ok || /HTTP\/1\.1 [45]\d\d/.test(text)) throw new Error(`Dataverse rejeitou a importação OFX atômica. Nenhum lançamento foi confirmado.${batchErrorDetail(text)}`);
}

export async function importOfxAtomically(context: RuntimeContext, result: OfxImportResult, account: string, accountId: string, file: File, entries: CashflowEntry[]): Promise<void> {
  if (context.mode === 'mock') return;
  if (!context.clientUrl) throw new Error('Contexto Dataverse sem URL para importação OFX.');
  if (await importExists(context, result.fingerprint)) throw new Error('Importação bloqueada: este arquivo OFX já foi processado.');
  if (await transactionExists(context, entries.map((entry) => entry.transactionKey).filter((key): key is string => Boolean(key)))) throw new Error('Importação bloqueada: transação OFX já existe nesta conta.');
  let importId: string | undefined;
  try {
    importId = await createImport(context, result, account, accountId);
    await uploadOriginalFile(context, importId, file);
    await saveBatch(context, importId, entries);
  } catch (error) {
    if (importId) await fetch(`${context.clientUrl}/api/data/v9.2/cr40f_fluxocaixaimportacaos(${importId})`, { method: 'DELETE', credentials: 'same-origin' }).catch(() => undefined);
    throw error;
  }
}

export async function updateReconciliation(context: RuntimeContext, actual: CashflowEntry, forecast: CashflowEntry): Promise<void> {
  if (context.mode === 'mock') return;
  if (!context.clientUrl) throw new Error('Contexto Dataverse sem URL para conciliação.');
  if (!actual.etag || !forecast.etag) throw new Error('Atualize os dados antes de conciliar para proteger a conciliação 1:1.');
  const request = buildReconciliationBatch(actual, forecast);
  const response = await fetch(`${context.clientUrl}/api/data/v9.2/$batch`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': `multipart/mixed;boundary=${request.batch}` }, body: request.body });
  const text = await response.text();
  if (!response.ok || /HTTP\/1\.1 (409|412|4\d\d|5\d\d)/.test(text)) throw new Error('Conciliação não foi gravada; os dados podem ter sido alterados por outro usuário.');
}

function mapEntry(record: Record<string, unknown>): CashflowEntry {
  return { id: String(record.cr40f_fluxocaixalancamentoid), description: String(record.cr40f_name ?? ''), category: String(record.cr40f_categoria ?? 'A classificar'), categoryId: record._cr40f_categoriaref_value as string | undefined, group: String(record.cr40f_grupo ?? 'A classificar'), amount: Number(record.cr40f_valor ?? 0), date: String(record.cr40f_data ?? '').slice(0, 10), kind: String(record.cr40f_tipo ?? 'forecast') as CashflowEntry['kind'], nature: String(record.cr40f_natureza ?? 'outflow') as CashflowEntry['nature'], status: String(record.cr40f_status ?? 'open') as CashflowEntry['status'], source: String(record.cr40f_origem ?? 'manual') as CashflowEntry['source'], account: record.cr40f_conta as string | undefined, accountId: record._cr40f_contaref_value as string | undefined, counterparty: record.cr40f_contraparte as string | undefined, counterpartyId: record._cr40f_contraparteref_value as string | undefined, originalDescription: record.cr40f_descricaooriginal as string | undefined, originalDate: (record.cr40f_dataoriginal as string | undefined)?.slice(0, 10), fitId: record.cr40f_fitid as string | undefined, transactionKey: record.cr40f_chavetransacao as string | undefined, originId: record.cr40f_origemid as string | undefined, importId: (record._cr40f_importacaoref_value ?? record.cr40f_importacaoid) as string | undefined, reconciledWithId: (record._cr40f_conciliadocom_value ?? record.cr40f_conciliadocomid) as string | undefined, etag: record['@odata.etag'] as string | undefined };
}

export async function loadEntries(context: RuntimeContext): Promise<CashflowEntry[]> {
  if (context.mode === 'mock') return [];
  const query = '?$select=cr40f_fluxocaixalancamentoid,cr40f_name,cr40f_data,cr40f_valor,cr40f_categoria,cr40f_grupo,cr40f_origem,cr40f_tipo,cr40f_natureza,cr40f_status,cr40f_conta,cr40f_contraparte,cr40f_chavetransacao,cr40f_origemid,cr40f_importacaoid,cr40f_conciliadocomid,cr40f_fitid,cr40f_descricaooriginal,cr40f_dataoriginal,_cr40f_contaref_value,_cr40f_categoriaref_value,_cr40f_contraparteref_value,_cr40f_importacaoref_value,_cr40f_conciliadocom_value&$orderby=cr40f_data asc';
  const records = context.mode === 'xrm' && context.xrm?.WebApi ? (await context.xrm.WebApi.retrieveMultipleRecords('cr40f_fluxocaixalancamento', query)).entities : (await directRequest(context, `${entrySet}${query}`).then((response) => response.json()) as { value: Record<string, unknown>[] }).value;
  return records.map(mapEntry);
}

export async function loadRecurringForecasts(context: RuntimeContext, until: Date, holidays: string[] = []): Promise<CashflowEntry[]> {
  if (context.mode === 'mock') return [];
  const query = '?$select=cr40f_fluxocaixarecorrenciaid,cr40f_name,cr40f_valor,cr40f_categoria,cr40f_natureza,cr40f_frequencia,cr40f_inicio,cr40f_fim,cr40f_intervalodias,cr40f_ajustevencimento,_cr40f_categoriaref_value,_cr40f_contraparteref_value';
  const rows = context.mode === 'xrm' && context.xrm?.WebApi ? (await context.xrm.WebApi.retrieveMultipleRecords('cr40f_fluxocaixarecorrencia', query)).entities : (await directRequest(context, `cr40f_fluxocaixarecorrencias${query}`).then((response) => response.json()) as { value: Record<string, unknown>[] }).value;
  const desired: CashflowEntry[] = [];
  for (const row of rows) {
    const recurrenceId = String(row.cr40f_fluxocaixarecorrenciaid);
    const end = String(row.cr40f_fim ?? until.toISOString().slice(0, 10)).slice(0, 10);
    const frequency = String(row.cr40f_frequencia ?? 'monthly').toLowerCase() as 'weekly' | 'monthly' | 'annual' | 'custom';
    const dates = generateRecurrenceDates({ start: String(row.cr40f_inicio).slice(0, 10), end, frequency, intervalDays: Number(row.cr40f_intervalodias ?? 0) || undefined, businessDayPolicy: String(row.cr40f_ajustevencimento ?? 'same') as FinanceReference['businessDayPolicy'], holidays });
    for (const date of dates) desired.push({ id: `${recurrenceId}:${date}`, description: String(row.cr40f_name), category: String(row.cr40f_categoria ?? 'Administrativo'), categoryId: row._cr40f_categoriaref_value as string | undefined, counterpartyId: row._cr40f_contraparteref_value as string | undefined, group: 'Recorrências', amount: Number(row.cr40f_valor), date, kind: 'forecast', nature: String(row.cr40f_natureza ?? 'outflow') as CashflowEntry['nature'], status: 'open', source: 'recurrence', originId: `${recurrenceId}:${date}` });
  }
  const persisted = await loadEntries(context);
  const plan = planRecurringSync(desired, persisted, new Date().toISOString().slice(0, 10));
  for (const entry of plan.create) await saveEntry(context, entry);
  for (const item of plan.update) await patchEntry(context, item.current, item.next);
  for (const entry of plan.ignore) await patchEntry(context, entry, { status: 'ignored' });
  return (await loadEntries(context)).filter((entry) => entry.source === 'recurrence' && entry.status !== 'ignored');
}

export function planRecurringSync(desired: CashflowEntry[], persisted: CashflowEntry[], today: string): ReturnType<typeof planOrderSync> {
  const recurring = persisted.filter((entry) => entry.source === 'recurrence' && entry.originId);
  const plan = planOrderSync(desired.map((entry) => ({ ...entry, source: 'order' })), recurring.map((entry) => ({ ...entry, source: 'order' })));
  return {
    create: plan.create.map((entry) => ({ ...entry, source: 'recurrence' })),
    update: plan.update.map((item) => ({ current: { ...item.current, source: 'recurrence' }, next: { ...item.next, source: 'recurrence' } })),
    ignore: plan.ignore.filter((entry) => entry.date >= today).map((entry) => ({ ...entry, source: 'recurrence' }))
  };
}

export async function loadOrderMapping(context: RuntimeContext): Promise<OrderMapping | undefined> {
  if (context.mode === 'mock') return undefined;
  const query = '?$select=cr40f_entidadeop,cr40f_campoidop,cr40f_camponomeop,cr40f_campovalorop,cr40f_campodataop,cr40f_campostatusop,cr40f_valorativoop,cr40f_categoriaop,cr40f_campocontraparteop,_cr40f_categoriaopref_value&$top=1';
  const records = context.mode === 'xrm' && context.xrm?.WebApi ? (await context.xrm.WebApi.retrieveMultipleRecords('cr40f_fluxocaixaconfiguracao', query)).entities : (await directRequest(context, `cr40f_fluxocaixaconfiguracaos${query}`).then((response) => response.json()) as { value: Record<string, unknown>[] }).value;
  const config = records[0];
  if (!config?.cr40f_entidadeop || !config.cr40f_campoidop || !config.cr40f_camponomeop || !config.cr40f_campovalorop || !config.cr40f_campodataop || !config.cr40f_campostatusop || config.cr40f_valorativoop === undefined) return undefined;
  const entity = await loadEntityMetadata(context, String(config.cr40f_entidadeop), false);
  return {
    entityLogicalName: entity.logicalName,
    entitySetName: entity.entitySetName,
    idField: String(config.cr40f_campoidop),
    nameField: String(config.cr40f_camponomeop),
    amountField: String(config.cr40f_campovalorop),
    dueDateField: String(config.cr40f_campodataop),
    statusField: String(config.cr40f_campostatusop),
    activeStatusValue: String(config.cr40f_valorativoop),
    categoryId: config._cr40f_categoriaopref_value ? String(config._cr40f_categoriaopref_value) : undefined,
    categoryName: String(config.cr40f_categoriaop ?? 'Recebimentos de clientes'),
    counterpartyField: config.cr40f_campocontraparteop ? String(config.cr40f_campocontraparteop) : undefined
  };
}

export async function verifyOrderMapping(context: RuntimeContext, mapping: OrderMapping): Promise<void> {
  if (context.mode === 'mock') return;
  const metadata = await loadEntityMetadata(context, mapping.entityLogicalName);
  if (metadata.entitySetName !== mapping.entitySetName) throw new Error('EntitySetName da OP não confere com a metadata.');
  const available = new Set(metadata.attributes.map((attribute) => attribute.logicalName));
  for (const field of [mapping.idField, mapping.nameField, mapping.amountField, mapping.dueDateField, mapping.statusField, mapping.counterpartyField].filter((value): value is string => Boolean(value))) if (!available.has(field)) throw new Error(`Campo OP não encontrado na metadata: ${field}`);
}

export async function syncActiveOrders(context: RuntimeContext, mapping?: OrderMapping): Promise<CashflowEntry[]> {
  if (!mapping) throw new Error('Configure o mapeamento completo de OP antes de sincronizar.');
  await verifyOrderMapping(context, mapping);
  if (context.mode === 'mock') return [];
  const statusValue = typeof mapping.activeStatusValue === 'string' && !/^-?\d+(\.\d+)?$/.test(mapping.activeStatusValue)
    ? `'${odata(mapping.activeStatusValue)}'`
    : String(mapping.activeStatusValue);
  const fields = [mapping.idField, mapping.nameField, mapping.amountField, mapping.dueDateField, mapping.statusField, mapping.counterpartyField].filter((value): value is string => Boolean(value));
  const query = `?$select=${fields.join(',')}&$filter=${encodeURIComponent(`${mapping.statusField} eq ${statusValue}`)}`;
  const response = context.mode === 'xrm' ? await context.xrm?.WebApi?.retrieveMultipleRecords(mapping.entityLogicalName, query) : await directRequest(context, `${mapping.entitySetName}${query}`).then((item) => item.json());
  const records: Record<string, unknown>[] = 'entities' in (response ?? {}) ? response.entities : (response as { value?: Record<string, unknown>[] }).value ?? [];
  const forecasts = records.map((record: Record<string, unknown>) => {
    const value = Number(record[mapping.amountField]);
    const due = String(record[mapping.dueDateField] ?? '');
    return {
      id: `order-${String(record[mapping.idField])}`,
      description: String(record[mapping.nameField]),
      category: mapping.categoryName,
      categoryId: mapping.categoryId,
      group: 'Operacional',
      amount: value,
      date: due.slice(0, 10),
      kind: 'forecast',
      nature: 'inflow',
      status: 'open',
      source: 'order',
      originId: String(record[mapping.idField]),
      counterparty: mapping.counterpartyField ? String(record[mapping.counterpartyField] ?? '') : undefined
    } satisfies CashflowEntry;
  }).filter((entry: CashflowEntry) => entry.originId && entry.description && /^\d{4}-\d{2}-\d{2}$/.test(entry.date) && Number.isFinite(entry.amount) && entry.amount > 0);
  const persisted = await loadEntries(context);
  const plan = planOrderSync(forecasts, persisted);
  for (const forecast of plan.create) await saveEntry(context, forecast);
  for (const item of plan.update) await patchEntry(context, item.current, item.next);
  for (const entry of plan.ignore) await patchEntry(context, entry, { status: 'ignored' });
  return (await loadEntries(context)).filter((entry) => entry.source === 'order' && entry.status !== 'ignored');
}

export function planOrderSync(remote: CashflowEntry[], persisted: CashflowEntry[]): {
  create: CashflowEntry[];
  update: Array<{ current: CashflowEntry; next: CashflowEntry }>;
  ignore: CashflowEntry[];
} {
  const stored = persisted.filter((entry) => entry.source === 'order' && entry.originId);
  const byOrigin = new Map(stored.map((entry) => [entry.originId!, entry]));
  const remoteIds = new Set(remote.map((entry) => entry.originId).filter((value): value is string => Boolean(value)));
  const create: CashflowEntry[] = [];
  const update: Array<{ current: CashflowEntry; next: CashflowEntry }> = [];
  for (const next of remote) {
    const current = next.originId ? byOrigin.get(next.originId) : undefined;
    if (!current) create.push(next);
    else if (current.status === 'open' && (current.amount !== next.amount || current.date !== next.date || current.description !== next.description || current.counterparty !== next.counterparty || current.categoryId !== next.categoryId)) update.push({ current, next: { ...next, id: current.id, etag: current.etag } });
  }
  const ignore = stored.filter((entry) => entry.status === 'open' && !remoteIds.has(entry.originId!));
  return { create, update, ignore };
}

function localizedLabel(value: unknown): string {
  const labels = (value as { UserLocalizedLabel?: { Label?: string } } | undefined)?.UserLocalizedLabel;
  return labels?.Label ?? '';
}

export async function loadEntityMetadata(context: RuntimeContext, logicalName: string, includeAttributes = true): Promise<MetadataEntity> {
  const basePath = `EntityDefinitions(LogicalName='${odata(logicalName)}')?$select=LogicalName,EntitySetName,DisplayName`;
  const entity = await directRequest(context, basePath).then((response) => response.json()) as { LogicalName: string; EntitySetName: string; DisplayName?: unknown };
  let attributes: MetadataAttribute[] = [];
  if (includeAttributes) {
    const path = `EntityDefinitions(LogicalName='${odata(logicalName)}')/Attributes?$select=LogicalName,AttributeType,DisplayName&$filter=IsValidForRead eq true`;
    const result = await directRequest(context, path).then((response) => response.json()) as { value: Array<{ LogicalName: string; AttributeType: string; DisplayName?: unknown }> };
    attributes = await Promise.all(result.value.map(async (attribute) => {
      const mapped: MetadataAttribute = { logicalName: attribute.LogicalName, attributeType: attribute.AttributeType, displayName: localizedLabel(attribute.DisplayName) || attribute.LogicalName };
      if (!['Picklist', 'State', 'Status'].includes(attribute.AttributeType)) return mapped;
      try {
        const cast = `${attribute.AttributeType}AttributeMetadata`;
        const optionPath = `EntityDefinitions(LogicalName='${odata(logicalName)}')/Attributes(LogicalName='${odata(attribute.LogicalName)}')/Microsoft.Dynamics.CRM.${cast}?$select=LogicalName&$expand=OptionSet`;
        const optionMetadata = await directRequest(context, optionPath).then((response) => response.json()) as { OptionSet?: { Options?: Array<{ Value: number; Label?: unknown }> } };
        mapped.options = (optionMetadata.OptionSet?.Options ?? []).map((option) => ({ value: String(option.Value), label: localizedLabel(option.Label) || String(option.Value) }));
      } catch {
        mapped.options = [];
      }
      return mapped;
    }));
  }
  return { logicalName: entity.LogicalName, entitySetName: entity.EntitySetName, displayName: localizedLabel(entity.DisplayName) || entity.LogicalName, attributes };
}

export async function listCustomEntities(context: RuntimeContext): Promise<MetadataEntity[]> {
  if (context.mode === 'mock') return [];
  const path = 'EntityDefinitions?$select=LogicalName,EntitySetName,DisplayName&$filter=IsCustomEntity eq true';
  const result = await directRequest(context, path).then((response) => response.json()) as { value: Array<{ LogicalName: string; EntitySetName: string; DisplayName?: unknown }> };
  return result.value.map((entity) => ({ logicalName: entity.LogicalName, entitySetName: entity.EntitySetName, displayName: localizedLabel(entity.DisplayName) || entity.LogicalName, attributes: [] })).sort((a, b) => a.displayName.localeCompare(b.displayName, 'pt-BR'));
}

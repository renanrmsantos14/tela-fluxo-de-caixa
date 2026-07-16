import type { CashflowEntry, FinanceReference, OfxImportResult, OrderMapping, RuntimeContext } from '../types';

const entrySet = 'cr40f_fluxocaixalancamentos';

export const financeSets = {
  accounts: 'cr40f_fluxocaixacontas', categories: 'cr40f_fluxocaixacategorias',
  recurrences: 'cr40f_fluxocaixarecorrencias', rules: 'cr40f_fluxocaixaregras',
  holidays: 'cr40f_fluxocaixaferiados', settings: 'cr40f_fluxocaixaconfiguracaos',
  events: 'cr40f_fluxocaixaeventos', imports: 'cr40f_fluxocaixaimportacaos'
} as const;

function payload(entry: CashflowEntry): Record<string, unknown> {
  return {
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
    ,cr40f_origemid: entry.originId
    ,cr40f_conciliadocomid: entry.reconciledWithId
  };
}

function odata(value: string): string { return value.replace(/'/g, "''"); }

async function directRequest(context: RuntimeContext, path: string, options?: RequestInit): Promise<Response> {
  const response = await fetch(`${context.clientUrl}/api/data/v9.2/${path}`, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(options?.headers ?? {}) },
    ...options
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
  const result = await directRequest(context, `${setName}?$select=${select}&$orderby=createdon desc`).then((response) => response.json()) as { value: Record<string, unknown>[] };
  return result.value.map((record) => ({ id: String(Object.entries(record).find(([key]) => key.endsWith('id'))?.[1] ?? ''), name: String(record.cr40f_name ?? ''), group: record.cr40f_grupo as string | undefined, nature: record.cr40f_natureza as FinanceReference['nature'], bank: record.cr40f_banco as string | undefined, identifier: record.cr40f_identificador as string | undefined, amount: Number(record.cr40f_valor ?? 0), category: record.cr40f_categoria as string | undefined, frequency: record.cr40f_frequencia as FinanceReference['frequency'], intervalDays: Number(record.cr40f_intervalodias ?? 0) || undefined, start: String(record.cr40f_inicio ?? '').slice(0, 10) || undefined, end: String(record.cr40f_fim ?? '').slice(0, 10) || undefined, date: String(record.cr40f_data ?? '').slice(0, 10) || undefined, expression: record.cr40f_expressao as string | undefined, recipients: record.cr40f_destinatariosalerta as string | undefined, entity: record.cr40f_entidadeop as string | undefined, entitySet: record.cr40f_entitysetop as string | undefined, idField: record.cr40f_campoidop as string | undefined, amountField: record.cr40f_campovalorop as string | undefined, dateField: record.cr40f_campodataop as string | undefined }));
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
  const records = await directRequest(context, `${entrySet}?$select=cr40f_fluxocaixalancamentoid&$filter=${filter}`).then((response) => response.json()) as { value: Array<{ cr40f_fluxocaixalancamentoid: string }> };
  await Promise.all(records.value.map((record) => directRequest(context, `${entrySet}(${record.cr40f_fluxocaixalancamentoid})`, { method: 'PATCH', headers: { 'If-Match': '*' }, body: JSON.stringify({ cr40f_status: 'reversed' }) })));
  await directRequest(context, `${financeSets.imports}(${importId})`, { method: 'PATCH', headers: { 'If-Match': '*' }, body: JSON.stringify({ cr40f_status: 'reversed' }) });
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
  const filter = keys.map((key) => `cr40f_chavetransacao eq '${odata(key)}'`).join(' or ');
  const query = `?$select=cr40f_fluxocaixalancamentoid&$top=1&$filter=${encodeURIComponent(filter)}`;
  if (context.mode === 'xrm' && context.xrm?.WebApi) return (await context.xrm.WebApi.retrieveMultipleRecords('cr40f_fluxocaixalancamento', query)).entities.length > 0;
  return (await directRequest(context, `${entrySet}${query}`).then((response) => response.json()) as { value: unknown[] }).value.length > 0;
}

async function createImport(context: RuntimeContext, result: OfxImportResult, account: string): Promise<string> {
  const body = { cr40f_name: `OFX ${new Date().toISOString().slice(0, 10)}`, cr40f_fingerprint: result.fingerprint, cr40f_conta: account, cr40f_status: 'processing' };
  const response = await directRequest(context, 'cr40f_fluxocaixaimportacaos', { method: 'POST', body: JSON.stringify(body) });
  const entity = response.headers.get('OData-EntityId');
  const id = entity?.match(/\(([0-9a-f-]{36})\)$/i)?.[1];
  if (!id) throw new Error('Dataverse não retornou o identificador da importação OFX.');
  return id;
}

async function uploadOriginalFile(context: RuntimeContext, importId: string, file: File): Promise<void> {
  const response = await fetch(`${context.clientUrl}/api/data/v9.2/cr40f_fluxocaixaimportacaos(${importId})/cr40f_arquivoofx?x-ms-file-name=${encodeURIComponent(file.name)}`, { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream', 'x-ms-file-name': file.name }, body: await file.arrayBuffer() });
  if (!response.ok) throw new Error(`Falha ao guardar OFX original (${response.status}).`);
}

async function saveBatch(context: RuntimeContext, importId: string, entries: CashflowEntry[]): Promise<void> {
  const batch = `batch_${crypto.randomUUID().replaceAll('-', '')}`;
  const changeSet = `changeset_${crypto.randomUUID().replaceAll('-', '')}`;
  const lines = [`--${batch}`, `Content-Type: multipart/mixed;boundary=${changeSet}`, ''];
  for (const entry of entries) {
    lines.push(`--${changeSet}`, 'Content-Type: application/http', 'Content-Transfer-Encoding: binary', '', `POST /api/data/v9.2/${entrySet} HTTP/1.1`, 'Content-Type: application/json', '', JSON.stringify({ ...payload(entry), cr40f_importacaoid: importId }), '');
  }
  lines.push(`--${changeSet}`, 'Content-Type: application/http', 'Content-Transfer-Encoding: binary', '', `PATCH /api/data/v9.2/cr40f_fluxocaixaimportacaos(${importId}) HTTP/1.1`, 'Content-Type: application/json', '', JSON.stringify({ cr40f_status: 'imported' }), '', `--${changeSet}--`, `--${batch}--`, '');
  const response = await fetch(`${context.clientUrl}/api/data/v9.2/$batch`, { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json', 'Content-Type': `multipart/mixed;boundary=${batch}` }, body: lines.join('\r\n') });
  const text = await response.text();
  if (!response.ok || /HTTP\/1\.1 [45]\d\d/.test(text)) throw new Error('Dataverse rejeitou a importação OFX atômica. Nenhum lançamento foi confirmado.');
}

export async function importOfxAtomically(context: RuntimeContext, result: OfxImportResult, account: string, file: File, entries: CashflowEntry[]): Promise<void> {
  if (context.mode === 'mock') return;
  if (!context.clientUrl) throw new Error('Contexto Dataverse sem URL para importação OFX.');
  if (await importExists(context, result.fingerprint)) throw new Error('Importação bloqueada: este arquivo OFX já foi processado.');
  if (await transactionExists(context, entries.map((entry) => entry.transactionKey).filter((key): key is string => Boolean(key)))) throw new Error('Importação bloqueada: transação OFX já existe nesta conta.');
  let importId: string | undefined;
  try {
    importId = await createImport(context, result, account);
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
  const batch = `batch_${crypto.randomUUID().replaceAll('-', '')}`;
  const changeSet = `changeset_${crypto.randomUUID().replaceAll('-', '')}`;
  const lines = [`--${batch}`, `Content-Type: multipart/mixed;boundary=${changeSet}`, ''];
  for (const [entry, counterpart] of [[actual, forecast], [forecast, actual]] as const) lines.push(`--${changeSet}`, 'Content-Type: application/http', 'Content-Transfer-Encoding: binary', '', `PATCH /api/data/v9.2/${entrySet}(${entry.id}) HTTP/1.1`, 'Content-Type: application/json', `If-Match: ${entry.etag}`, '', JSON.stringify({ cr40f_status: 'reconciled', cr40f_conciliadocomid: counterpart.id }), '');
  lines.push(`--${changeSet}--`, `--${batch}--`, '');
  const response = await fetch(`${context.clientUrl}/api/data/v9.2/$batch`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': `multipart/mixed;boundary=${batch}` }, body: lines.join('\r\n') });
  const text = await response.text();
  if (!response.ok || /HTTP\/1\.1 (409|412|4\d\d|5\d\d)/.test(text)) throw new Error('Conciliação não foi gravada; os dados podem ter sido alterados por outro usuário.');
}

function mapEntry(record: Record<string, unknown>): CashflowEntry {
  return { id: String(record.cr40f_fluxocaixalancamentoid), description: String(record.cr40f_name ?? ''), category: String(record.cr40f_categoria ?? 'A classificar'), group: String(record.cr40f_grupo ?? 'A classificar'), amount: Number(record.cr40f_valor ?? 0), date: String(record.cr40f_data ?? '').slice(0, 10), kind: String(record.cr40f_tipo ?? 'forecast') as CashflowEntry['kind'], nature: String(record.cr40f_natureza ?? 'outflow') as CashflowEntry['nature'], status: String(record.cr40f_status ?? 'open') as CashflowEntry['status'], source: String(record.cr40f_origem ?? 'manual') as CashflowEntry['source'], account: record.cr40f_conta as string | undefined, originalDescription: record.cr40f_descricaooriginal as string | undefined, originalDate: (record.cr40f_dataoriginal as string | undefined)?.slice(0, 10), fitId: record.cr40f_fitid as string | undefined, transactionKey: record.cr40f_chavetransacao as string | undefined, originId: record.cr40f_origemid as string | undefined, importId: record.cr40f_importacaoid as string | undefined, reconciledWithId: record.cr40f_conciliadocomid as string | undefined, etag: record['@odata.etag'] as string | undefined };
}

export async function loadEntries(context: RuntimeContext): Promise<CashflowEntry[]> {
  if (context.mode === 'mock') return [];
  const query = '?$select=cr40f_fluxocaixalancamentoid,cr40f_name,cr40f_data,cr40f_valor,cr40f_categoria,cr40f_grupo,cr40f_origem,cr40f_tipo,cr40f_natureza,cr40f_status,cr40f_conta,cr40f_chavetransacao,cr40f_origemid,cr40f_importacaoid,cr40f_conciliadocomid,cr40f_fitid,cr40f_descricaooriginal,cr40f_dataoriginal&$orderby=cr40f_data asc';
  const records = context.mode === 'xrm' && context.xrm?.WebApi ? (await context.xrm.WebApi.retrieveMultipleRecords('cr40f_fluxocaixalancamento', query)).entities : (await directRequest(context, `${entrySet}${query}`).then((response) => response.json()) as { value: Record<string, unknown>[] }).value;
  return records.map(mapEntry);
}

export async function loadRecurringForecasts(context: RuntimeContext, until: Date): Promise<CashflowEntry[]> {
  if (context.mode === 'mock') return [];
  const query = '?$select=cr40f_fluxocaixarecorrenciaid,cr40f_name,cr40f_valor,cr40f_categoria,cr40f_natureza,cr40f_frequencia,cr40f_inicio,cr40f_fim,cr40f_intervalodias';
  const rows = context.mode === 'xrm' && context.xrm?.WebApi ? (await context.xrm.WebApi.retrieveMultipleRecords('cr40f_fluxocaixarecorrencia', query)).entities : (await directRequest(context, `cr40f_fluxocaixarecorrencias${query}`).then((response) => response.json()) as { value: Record<string, unknown>[] }).value;
  const generated: CashflowEntry[] = [];
  for (const row of rows) {
    const frequency = String(row.cr40f_frequencia ?? 'monthly').toLowerCase();
    const interval = Number(row.cr40f_intervalodias ?? 30);
    const end = row.cr40f_fim ? new Date(String(row.cr40f_fim)) : until;
    for (let date = new Date(String(row.cr40f_inicio)); date <= until && date <= end; ) {
      generated.push({ id: `${String(row.cr40f_fluxocaixarecorrenciaid)}:${date.toISOString().slice(0, 10)}`, description: String(row.cr40f_name), category: String(row.cr40f_categoria ?? 'Administrativo'), group: 'Recorrências', amount: Number(row.cr40f_valor), date: date.toISOString().slice(0, 10), kind: 'forecast', nature: String(row.cr40f_natureza ?? 'outflow') as CashflowEntry['nature'], status: 'open', source: 'recurrence' });
      if (frequency === 'weekly') date.setDate(date.getDate() + 7);
      else if (frequency === 'annual') date.setFullYear(date.getFullYear() + 1);
      else if (frequency === 'custom') date.setDate(date.getDate() + Math.max(1, interval));
      else date.setMonth(date.getMonth() + 1);
    }
  }
  return generated;
}

export async function loadOrderMapping(context: RuntimeContext): Promise<OrderMapping | undefined> {
  if (context.mode === 'mock') return undefined;
  const query = '?$select=cr40f_entidadeop,cr40f_entitysetop,cr40f_campoidop,cr40f_campovalorop,cr40f_campodataop&$top=1';
  const records = context.mode === 'xrm' && context.xrm?.WebApi ? (await context.xrm.WebApi.retrieveMultipleRecords('cr40f_fluxocaixaconfiguracao', query)).entities : (await directRequest(context, `cr40f_fluxocaixaconfiguracaos${query}`).then((response) => response.json()) as { value: Record<string, unknown>[] }).value;
  const config = records[0];
  if (!config?.cr40f_entidadeop || !config.cr40f_entitysetop || !config.cr40f_campoidop || !config.cr40f_campovalorop) return undefined;
  return { entityLogicalName: String(config.cr40f_entidadeop), entitySetName: String(config.cr40f_entitysetop), idField: String(config.cr40f_campoidop), amountField: String(config.cr40f_campovalorop), dueDateField: config.cr40f_campodataop ? String(config.cr40f_campodataop) : undefined };
}

export async function verifyOrderMapping(context: RuntimeContext, mapping: OrderMapping): Promise<void> {
  if (context.mode === 'mock') return;
  const select = ['LogicalName', 'EntitySetName'].join(',');
  const path = `EntityDefinitions(LogicalName='${mapping.entityLogicalName}')?$select=${select}`;
  const response = await directRequest(context, path);
  const metadata = await response.json() as { EntitySetName?: string };
  if (metadata.EntitySetName !== mapping.entitySetName) throw new Error('EntitySetName da OP não confere com a configuração.');
  for (const field of [mapping.idField, mapping.amountField, mapping.dueDateField].filter((value): value is string => Boolean(value))) {
    const attribute = await directRequest(context, `EntityDefinitions(LogicalName='${mapping.entityLogicalName}')/Attributes?$select=LogicalName&$top=1&$filter=LogicalName eq '${odata(field)}'`).then((item) => item.json()) as { value: unknown[] };
    if (!attribute.value.length) throw new Error(`Campo OP não encontrado na metadata: ${field}`);
  }
}

export async function syncActiveOrders(context: RuntimeContext, mapping?: OrderMapping): Promise<CashflowEntry[]> {
  if (!mapping) return [];
  await verifyOrderMapping(context, mapping);
  if (context.mode === 'mock') return [];
  const query = `?$select=${[mapping.idField, mapping.amountField, mapping.dueDateField, mapping.issueDateField].filter(Boolean).join(',')}${mapping.statusFilter ? `&$filter=${encodeURIComponent(mapping.statusFilter)}` : ''}`;
  const response = context.mode === 'xrm' ? await context.xrm?.WebApi?.retrieveMultipleRecords(mapping.entityLogicalName, query) : await directRequest(context, `${mapping.entitySetName}${query}`).then((item) => item.json());
  const records: Record<string, unknown>[] = 'entities' in (response ?? {}) ? response.entities : (response as { value?: Record<string, unknown>[] }).value ?? [];
  const forecasts = records.map((record: Record<string, unknown>, index: number) => {
    const value = Number(record[mapping.amountField]);
    const due = String(record[mapping.dueDateField ?? ''] ?? record[mapping.issueDateField ?? ''] ?? new Date().toISOString().slice(0, 10));
    return {
      id: `order-${index}`,
      description: `OP ${String(record['cr40f_name'] ?? record['name'] ?? index + 1)}`,
      category: 'Recebimentos de clientes', group: 'Operacional', amount: value, date: due.slice(0, 10),
      kind: 'forecast', nature: 'inflow', status: 'open', source: 'order', originId: String(record[mapping.idField])
    } satisfies CashflowEntry;
  }).filter((entry: CashflowEntry) => Number.isFinite(entry.amount) && entry.amount > 0);
  const persisted = await loadEntries(context);
  const byOrigin = new Map(persisted.filter((entry) => entry.source === 'order' && entry.originId).map((entry) => [entry.originId, entry]));
  const synced: CashflowEntry[] = [];
  for (const forecast of forecasts) {
    const existing = byOrigin.get(forecast.originId);
    if (existing) { synced.push(existing); continue; }
    const id = await saveEntry(context, forecast);
    synced.push({ ...forecast, id });
  }
  return synced;
}

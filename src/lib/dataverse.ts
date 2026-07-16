import type {
  CashflowEntry,
  ClassificationRule,
  FinanceReference,
  OfxImportResult,
  RuntimeContext,
} from '../types';
import type { ImportedCategory } from './category-import';

const entrySet = 'cr40f_fluxocaixalancamentos';
export const financeSets = {
  accounts: 'cr40f_fluxocaixacontas',
  categories: 'cr40f_fluxocaixacategorias',
  counterparties: 'cr40f_fluxocaixacontrapartes',
  rules: 'cr40f_fluxocaixaregras',
  events: 'cr40f_fluxocaixaeventos',
  imports: 'cr40f_fluxocaixaimportacaos',
} as const;

const primaryIds: Record<string, string> = {
  [financeSets.accounts]: 'cr40f_fluxocaixacontaid',
  [financeSets.categories]: 'cr40f_fluxocaixacategoriaid',
  [financeSets.counterparties]: 'cr40f_fluxocaixacontraparteid',
  [financeSets.rules]: 'cr40f_fluxocaixaregraid',
  [financeSets.events]: 'cr40f_fluxocaixaeventoid',
  [financeSets.imports]: 'cr40f_fluxocaixaimportacaoid',
};

function odata(value: string): string {
  return value.replace(/'/g, "''");
}

function entryPayload(entry: CashflowEntry): Record<string, unknown> {
  const body: Record<string, unknown> = {
    cr40f_name: entry.description,
    cr40f_data: entry.date,
    cr40f_valor: Math.abs(entry.amount),
    cr40f_categoria: entry.category,
    cr40f_grupo: entry.group,
    cr40f_origem: 'ofx',
    cr40f_tipo: 'actual',
    cr40f_natureza: entry.nature,
    cr40f_status: entry.status,
    cr40f_conta: entry.account,
    cr40f_contraparte: entry.counterparty,
    cr40f_chavetransacao: entry.transactionKey,
    cr40f_fitid: entry.fitId,
    cr40f_descricaooriginal: entry.originalDescription,
    cr40f_dataoriginal: entry.originalDate,
    cr40f_nameoriginal: entry.originalName,
    cr40f_memooriginal: entry.originalMemo,
    cr40f_tipoofx: entry.bankTransactionType,
    cr40f_checknum: entry.checkNumber,
    cr40f_refnum: entry.referenceNumber,
    cr40f_textonormalizado: entry.normalizedText,
    cr40f_conflitoregra: Boolean(entry.ruleConflict),
  };
  if (entry.accountId) body['cr40f_ContaRef@odata.bind'] = `/cr40f_fluxocaixacontas(${entry.accountId})`;
  if (entry.categoryId) body['cr40f_CategoriaRef@odata.bind'] = `/cr40f_fluxocaixacategorias(${entry.categoryId})`;
  if (entry.counterpartyId) body['cr40f_ContraparteRef@odata.bind'] = `/${financeSets.counterparties}(${entry.counterpartyId})`;
  if (entry.importId) body['cr40f_ImportacaoRef@odata.bind'] = `/cr40f_fluxocaixaimportacaos(${entry.importId})`;
  if (entry.ruleId) body['cr40f_RegraRef@odata.bind'] = `/cr40f_fluxocaixaregras(${entry.ruleId})`;
  return body;
}

async function request(context: RuntimeContext, path: string, options: RequestInit = {}): Promise<Response> {
  if (!context.clientUrl) throw new Error('Contexto Dataverse sem URL.');
  const headers = new Headers(options.headers);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  if (!headers.has('Content-Type') && options.body !== undefined) headers.set('Content-Type', 'application/json; charset=utf-8');
  const response = await fetch(`${context.clientUrl}/api/data/v9.2/${path}`, {
    ...options,
    credentials: 'same-origin',
    headers,
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Dataverse respondeu ${response.status}${batchErrorDetail(detail)}.`);
  }
  return response;
}

function batchErrorDetail(text: string): string {
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } };
    return parsed.error?.message ? `: ${parsed.error.message}` : '';
  } catch {
    const match = text.match(/"message"\s*:\s*"([^"]+)"/i);
    return match ? `: ${match[1]}` : '';
  }
}

async function executeBatch(context: RuntimeContext, batch: { batch: string; body: string }, failure: string): Promise<void> {
  if (context.mode === 'mock') return;
  const response = await request(context, '$batch', {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/mixed; boundary=${batch.batch}`,
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0',
    },
    body: batch.body,
  });
  const text = await response.text();
  if (/HTTP\/1\.1 [45]\d\d/.test(text)) throw new Error(`${failure}${batchErrorDetail(text)}`);
}

export async function listReferences(context: RuntimeContext, setName: string, select: string): Promise<FinanceReference[]> {
  if (context.mode === 'mock') return [];
  const primaryId = primaryIds[setName];
  if (!primaryId) throw new Error(`Tabela mestre não mapeada: ${setName}.`);
  const result = await request(context, `${setName}?$select=${select}&$orderby=createdon desc`)
    .then((response) => response.json()) as { value: Record<string, unknown>[] };
  return result.value.map((record) => ({
    id: String(record[primaryId] ?? ''),
    name: String(record.cr40f_nomerazaosocial ?? record.cr40f_name ?? ''),
    group: record.cr40f_grupo as string | undefined,
    nature: record.cr40f_natureza as FinanceReference['nature'],
    bank: record.cr40f_banco as string | undefined,
    identifier: record.cr40f_identificador as string | undefined,
    document: record.cr40f_documento as string | undefined,
    type: record.cr40f_tipo as string | undefined,
    email: record.cr40f_email as string | undefined,
    phone: record.cr40f_telefone as string | undefined,
    notes: record.cr40f_observacao as string | undefined,
    category: record.cr40f_categoria as string | undefined,
    categoryId: record._cr40f_categoriaref_value as string | undefined,
    accountId: record._cr40f_contaref_value as string | undefined,
    counterpartyId: record._cr40f_contraparteref_value as string | undefined,
    expression: record.cr40f_expressao as string | undefined,
    action: record.cr40f_acao as string | undefined,
    detail: record.cr40f_detalhe as string | undefined,
    date: String(record.cr40f_data ?? '').slice(0, 10) || undefined,
    direction: record.cr40f_direcao as string | undefined,
    active: record.cr40f_ativo as boolean | undefined,
    status: record.cr40f_status as string | undefined,
  }));
}

export async function saveReference(
  context: RuntimeContext,
  setName: string,
  body: Record<string, unknown>,
  id?: string,
): Promise<string> {
  if (context.mode === 'mock') return id ?? crypto.randomUUID();
  if (id) {
    await request(context, `${setName}(${id})`, {
      method: 'PATCH',
      headers: { 'If-Match': '*' },
      body: JSON.stringify(body),
    });
    return id;
  }
  const response = await request(context, setName, { method: 'POST', body: JSON.stringify(body) });
  return response.headers.get('OData-EntityId')?.match(/\(([0-9a-f-]{36})\)$/i)?.[1] ?? crypto.randomUUID();
}

export async function deleteReference(context: RuntimeContext, setName: string, id: string): Promise<void> {
  if (context.mode === 'mock') return;
  await request(context, `${setName}(${id})`, { method: 'DELETE', headers: { 'If-Match': '*' } });
}

export async function loadDestinatarios(context: RuntimeContext): Promise<FinanceReference[]> {
  return listReferences(context, financeSets.counterparties, 'cr40f_fluxocaixacontraparteid,cr40f_name,cr40f_tipo,cr40f_documento,cr40f_chavepix,cr40f_email,cr40f_telefone,cr40f_observacao');
}

export async function patchEntry(context: RuntimeContext, entry: CashflowEntry, changes: Partial<CashflowEntry>): Promise<void> {
  if (context.mode === 'mock') return;
  await request(context, `${entrySet}(${entry.id})`, {
    method: 'PATCH',
    headers: { 'If-Match': entry.etag ?? '*' },
    body: JSON.stringify(entryPayload({ ...entry, ...changes })),
  });
}

export async function audit(context: RuntimeContext, action: string, detail: string): Promise<void> {
  await saveReference(context, financeSets.events, {
    cr40f_name: action,
    cr40f_acao: action,
    cr40f_detalhe: detail,
    cr40f_data: new Date().toISOString(),
  });
}

export async function loadEntries(context: RuntimeContext): Promise<CashflowEntry[]> {
  if (context.mode === 'mock') return [];
  const fields = [
    'cr40f_fluxocaixalancamentoid', 'cr40f_name', 'cr40f_data', 'cr40f_valor',
    'cr40f_categoria', 'cr40f_grupo', 'cr40f_natureza', 'cr40f_status',
    'cr40f_conta', 'cr40f_contraparte', 'cr40f_chavetransacao', 'cr40f_fitid',
    'cr40f_descricaooriginal', 'cr40f_dataoriginal', 'cr40f_nameoriginal',
    'cr40f_memooriginal', 'cr40f_tipoofx', 'cr40f_checknum', 'cr40f_refnum',
    'cr40f_textonormalizado', 'cr40f_conflitoregra', 'cr40f_datavalidacao',
    '_cr40f_contaref_value', '_cr40f_categoriaref_value', '_cr40f_contraparteref_value',
    '_cr40f_importacaoref_value', '_cr40f_regraref_value',
  ];
  const filter = encodeURIComponent("cr40f_origem eq 'ofx'");
  const query = `?$select=${fields.join(',')}&$filter=${filter}&$orderby=cr40f_data desc`;
  const rows = context.mode === 'xrm' && context.xrm?.WebApi
    ? (await context.xrm.WebApi.retrieveMultipleRecords('cr40f_fluxocaixalancamento', query)).entities
    : (await request(context, `${entrySet}${query}`).then((response) => response.json()) as { value: Record<string, unknown>[] }).value;
  return rows.map((record) => {
    const storedStatus = String(record.cr40f_status ?? 'pending');
    const status = storedStatus === 'open' ? 'pending' : storedStatus === 'reconciled' ? 'validated' : storedStatus;
    const nature = String(record.cr40f_natureza ?? 'outflow') as CashflowEntry['nature'];
    return {
      id: String(record.cr40f_fluxocaixalancamentoid),
      description: String(record.cr40f_name ?? record.cr40f_descricaooriginal ?? ''),
      category: String(record.cr40f_categoria ?? ''),
      categoryId: record._cr40f_categoriaref_value as string | undefined,
      group: String(record.cr40f_grupo ?? ''),
      amount: Math.abs(Number(record.cr40f_valor ?? 0)),
      date: String(record.cr40f_data ?? '').slice(0, 10),
      kind: 'actual',
      nature,
      status: status as CashflowEntry['status'],
      source: 'ofx',
      account: record.cr40f_conta as string | undefined,
      accountId: record._cr40f_contaref_value as string | undefined,
      counterparty: record.cr40f_contraparte as string | undefined,
      counterpartyId: record._cr40f_contraparteref_value as string | undefined,
      originalDescription: record.cr40f_descricaooriginal as string | undefined,
      originalDate: String(record.cr40f_dataoriginal ?? '').slice(0, 10) || undefined,
      originalName: record.cr40f_nameoriginal as string | undefined,
      originalMemo: record.cr40f_memooriginal as string | undefined,
      bankTransactionType: record.cr40f_tipoofx as string | undefined,
      checkNumber: record.cr40f_checknum as string | undefined,
      referenceNumber: record.cr40f_refnum as string | undefined,
      normalizedText: record.cr40f_textonormalizado as string | undefined,
      ruleConflict: Boolean(record.cr40f_conflitoregra),
      validatedAt: record.cr40f_datavalidacao as string | undefined,
      fitId: record.cr40f_fitid as string | undefined,
      transactionKey: record.cr40f_chavetransacao as string | undefined,
      importId: record._cr40f_importacaoref_value as string | undefined,
      ruleId: record._cr40f_regraref_value as string | undefined,
      etag: record['@odata.etag'] as string | undefined,
    };
  });
}

export async function loadClassificationRules(
  context: RuntimeContext,
  categories: FinanceReference[],
  counterparties: FinanceReference[],
): Promise<ClassificationRule[]> {
  const rows = await listReferences(
    context,
    financeSets.rules,
    'cr40f_fluxocaixaregraid,cr40f_name,cr40f_expressao,cr40f_direcao,cr40f_ativo,_cr40f_contaref_value,_cr40f_categoriaref_value,_cr40f_contraparteref_value',
  );
  return rows
    .filter((row) => row.expression && row.categoryId)
    .map((row) => {
      const category = categories.find((item) => item.id === row.categoryId);
      const counterparty = counterparties.find((item) => item.id === row.counterpartyId);
      return {
        id: row.id,
        name: row.name,
        pattern: row.expression!,
        direction: row.direction === 'inflow' ? 'inflow' : 'outflow',
        accountId: row.accountId,
        categoryId: row.categoryId!,
        categoryName: category?.name ?? '',
        group: category?.group ?? '',
        counterpartyId: row.counterpartyId,
        counterpartyName: counterparty?.name,
        active: row.active !== false,
      };
    });
}

function validationBody(entry: CashflowEntry, validatedAt: string, ruleReference?: string): Record<string, unknown> {
  if (!entry.categoryId) throw new Error(`Lançamento ${entry.id} sem categoria.`);
  const body: Record<string, unknown> = {
    cr40f_status: 'validated',
    cr40f_datavalidacao: validatedAt,
    cr40f_categoria: entry.category,
    cr40f_grupo: entry.group,
    cr40f_contraparte: entry.counterparty,
    cr40f_natureza: entry.nature,
    'cr40f_CategoriaRef@odata.bind': `/cr40f_fluxocaixacategorias(${entry.categoryId})`,
  };
  body['cr40f_ContraparteRef@odata.bind'] = entry.counterpartyId
    ? `/${financeSets.counterparties}(${entry.counterpartyId})`
    : null;
  if (ruleReference) body['cr40f_RegraRef@odata.bind'] = ruleReference;
  return body;
}

function assertValidatable(entry: CashflowEntry): void {
  if (!entry.etag) throw new Error(`Lançamento ${entry.id} sem ETag. Recarregue a tela.`);
  if (!entry.categoryId) throw new Error(`Lançamento ${entry.id} sem categoria.`);
  if (entry.status === 'reversed') throw new Error(`Lançamento ${entry.id} está revertido.`);
}

function ruleBody(rule: ClassificationRule, clearMissing = false): Record<string, unknown> {
  const body: Record<string, unknown> = {
    cr40f_name: rule.name,
    cr40f_expressao: rule.pattern,
    cr40f_direcao: rule.direction,
    cr40f_ativo: rule.active,
    cr40f_categoria: rule.categoryName,
    'cr40f_CategoriaRef@odata.bind': `/cr40f_fluxocaixacategorias(${rule.categoryId})`,
  };
  if (rule.accountId) body['cr40f_ContaRef@odata.bind'] = `/cr40f_fluxocaixacontas(${rule.accountId})`;
  else if (clearMissing) body['cr40f_ContaRef@odata.bind'] = null;
  if (rule.counterpartyId) body['cr40f_ContraparteRef@odata.bind'] = `/${financeSets.counterparties}(${rule.counterpartyId})`;
  else if (clearMissing) body['cr40f_ContraparteRef@odata.bind'] = null;
  return body;
}

export async function saveClassificationRule(context: RuntimeContext, rule: ClassificationRule): Promise<string> {
  return saveReference(context, financeSets.rules, ruleBody(rule, Boolean(rule.id)), rule.id || undefined);
}

export function buildValidationBatch(
  entries: CashflowEntry[],
  validatedAt = new Date().toISOString(),
  batch = `batch_${crypto.randomUUID().replaceAll('-', '')}`,
  changeSet = `changeset_${crypto.randomUUID().replaceAll('-', '')}`,
): { batch: string; body: string } {
  if (!entries.length) throw new Error('Selecione ao menos um lançamento.');
  entries.forEach(assertValidatable);
  const lines = [`--${batch}`, `Content-Type: multipart/mixed; boundary=${changeSet}`, ''];
  entries.forEach((entry, index) => {
    lines.push(
      `--${changeSet}`, 'Content-Type: application/http', 'Content-Transfer-Encoding: binary',
      `Content-ID: ${index + 1}`, '', `PATCH /api/data/v9.2/${entrySet}(${entry.id}) HTTP/1.1`,
      'Content-Type: application/json; charset=utf-8', `If-Match: ${entry.etag}`, '',
      JSON.stringify(validationBody(entry, validatedAt)), '',
    );
  });
  lines.push(`--${changeSet}--`, `--${batch}--`, '');
  return { batch, body: lines.join('\r\n') };
}

export function buildRuleValidationBatch(
  entry: CashflowEntry,
  rule: ClassificationRule,
  validatedAt = new Date().toISOString(),
  batch = `batch_${crypto.randomUUID().replaceAll('-', '')}`,
  changeSet = `changeset_${crypto.randomUUID().replaceAll('-', '')}`,
): { batch: string; body: string } {
  assertValidatable(entry);
  const lines = [
    `--${batch}`, `Content-Type: multipart/mixed; boundary=${changeSet}`, '',
    `--${changeSet}`, 'Content-Type: application/http', 'Content-Transfer-Encoding: binary',
    'Content-ID: 1', '', `POST /api/data/v9.2/${financeSets.rules} HTTP/1.1`,
    'Content-Type: application/json; charset=utf-8', '', JSON.stringify(ruleBody(rule)), '',
    `--${changeSet}`, 'Content-Type: application/http', 'Content-Transfer-Encoding: binary',
    'Content-ID: 2', '', `PATCH /api/data/v9.2/${entrySet}(${entry.id}) HTTP/1.1`,
    'Content-Type: application/json; charset=utf-8', `If-Match: ${entry.etag}`, '',
    JSON.stringify(validationBody(entry, validatedAt, '$1')), '',
    `--${changeSet}--`, `--${batch}--`, '',
  ];
  return { batch, body: lines.join('\r\n') };
}

export async function validateEntriesAtomically(context: RuntimeContext, entries: CashflowEntry[]): Promise<void> {
  await executeBatch(context, buildValidationBatch(entries), 'A validação não foi gravada.');
}

export async function saveRuleAndValidateAtomically(
  context: RuntimeContext,
  entry: CashflowEntry,
  rule: ClassificationRule,
): Promise<void> {
  await executeBatch(context, buildRuleValidationBatch(entry, rule), 'A regra e a validação não foram gravadas.');
}

export function buildOfxBatch(
  importId: string,
  entries: CashflowEntry[],
  batch = `batch_${crypto.randomUUID().replaceAll('-', '')}`,
  changeSet = `changeset_${crypto.randomUUID().replaceAll('-', '')}`,
): { batch: string; body: string } {
  const lines = [`--${batch}`, `Content-Type: multipart/mixed; boundary=${changeSet}`, ''];
  entries.forEach((entry, index) => {
    lines.push(
      `--${changeSet}`, 'Content-Type: application/http', 'Content-Transfer-Encoding: binary',
      `Content-ID: ${index + 1}`, '', `POST /api/data/v9.2/${entrySet} HTTP/1.1`,
      'Content-Type: application/json; charset=utf-8', '',
      JSON.stringify({
        ...entryPayload(entry),
        cr40f_importacaoid: importId,
        'cr40f_ImportacaoRef@odata.bind': `/cr40f_fluxocaixaimportacaos(${importId})`,
      }), '',
    );
  });
  lines.push(
    `--${changeSet}`, 'Content-Type: application/http', 'Content-Transfer-Encoding: binary',
    `Content-ID: ${entries.length + 1}`, '',
    `PATCH /api/data/v9.2/${financeSets.imports}(${importId}) HTTP/1.1`,
    'Content-Type: application/json; charset=utf-8', '', JSON.stringify({ cr40f_status: 'imported' }), '',
    `--${changeSet}--`, `--${batch}--`, '',
  );
  return { batch, body: lines.join('\r\n') };
}

export function buildReverseBatch(
  importId: string,
  entryIds: string[],
  _legacyCounterpartIds: string[] = [],
  batch = `batch_${crypto.randomUUID().replaceAll('-', '')}`,
  changeSet = `changeset_${crypto.randomUUID().replaceAll('-', '')}`,
): { batch: string; body: string } {
  const lines = [`--${batch}`, `Content-Type: multipart/mixed; boundary=${changeSet}`, ''];
  entryIds.forEach((id, index) => {
    lines.push(
      `--${changeSet}`, 'Content-Type: application/http', 'Content-Transfer-Encoding: binary',
      `Content-ID: ${index + 1}`, '', `PATCH /api/data/v9.2/${entrySet}(${id}) HTTP/1.1`,
      'Content-Type: application/json; charset=utf-8', '', JSON.stringify({ cr40f_status: 'reversed', cr40f_chavetransacao: null, 'cr40f_RegraRef@odata.bind': null }), '',
    );
  });
  lines.push(
    `--${changeSet}`, 'Content-Type: application/http', 'Content-Transfer-Encoding: binary',
    `Content-ID: ${entryIds.length + 1}`, '',
    `PATCH /api/data/v9.2/${financeSets.imports}(${importId}) HTTP/1.1`,
    'Content-Type: application/json; charset=utf-8', '', JSON.stringify({ cr40f_status: 'reversed', cr40f_fingerprint: null }), '',
    `--${changeSet}--`, `--${batch}--`, '',
  );
  return { batch, body: lines.join('\r\n') };
}

async function importExists(context: RuntimeContext, fingerprint: string): Promise<boolean> {
  const filter = `cr40f_fingerprint eq '${odata(fingerprint)}' and cr40f_status ne 'reversed'`;
  const query = `?$select=cr40f_fluxocaixaimportacaoid&$top=1&$filter=${encodeURIComponent(filter)}`;
  return (await request(context, `${financeSets.imports}${query}`).then((response) => response.json()) as { value: unknown[] }).value.length > 0;
}

async function transactionExists(context: RuntimeContext, keys: string[]): Promise<boolean> {
  for (let index = 0; index < keys.length; index += 20) {
    const keysFilter = keys.slice(index, index + 20).map((key) => `cr40f_chavetransacao eq '${odata(key)}'`).join(' or ');
    const filter = `(${keysFilter}) and cr40f_status ne 'reversed'`;
    const query = `?$select=cr40f_fluxocaixalancamentoid&$top=1&$filter=${encodeURIComponent(filter)}`;
    if ((await request(context, `${entrySet}${query}`).then((response) => response.json()) as { value: unknown[] }).value.length) return true;
  }
  return false;
}

async function releaseReversedImportFingerprint(context: RuntimeContext, fingerprint: string): Promise<void> {
  const filter = `cr40f_fingerprint eq '${odata(fingerprint)}' and cr40f_status eq 'reversed'`;
  const query = `?$select=cr40f_fluxocaixaimportacaoid&$filter=${encodeURIComponent(filter)}`;
  const result = await request(context, `${financeSets.imports}${query}`).then((response) => response.json()) as { value: Array<{ cr40f_fluxocaixaimportacaoid: string }> };
  await Promise.all(result.value.map((item) => request(context, `${financeSets.imports}(${item.cr40f_fluxocaixaimportacaoid})`, {
    method: 'PATCH', headers: { 'If-Match': '*' }, body: JSON.stringify({ cr40f_fingerprint: null }),
  })));
}

async function releaseReversedTransactionKeys(context: RuntimeContext, keys: string[]): Promise<void> {
  for (let index = 0; index < keys.length; index += 20) {
    const keysFilter = keys.slice(index, index + 20).map((key) => `cr40f_chavetransacao eq '${odata(key)}'`).join(' or ');
    const query = `?$select=cr40f_fluxocaixalancamentoid&$filter=${encodeURIComponent(`(${keysFilter}) and cr40f_status eq 'reversed'`)}`;
    const result = await request(context, `${entrySet}${query}`).then((response) => response.json()) as { value: Array<{ cr40f_fluxocaixalancamentoid: string }> };
    await Promise.all(result.value.map((item) => request(context, `${entrySet}(${item.cr40f_fluxocaixalancamentoid})`, {
      method: 'PATCH', headers: { 'If-Match': '*' }, body: JSON.stringify({ cr40f_chavetransacao: null }),
    })));
  }
}

export async function importOfxAtomically(
  context: RuntimeContext,
  result: OfxImportResult,
  account: string,
  accountId: string,
  file: File,
  entries: CashflowEntry[],
): Promise<void> {
  if (context.mode === 'mock') return;
  if (await importExists(context, result.fingerprint)) throw new Error('Este arquivo OFX já foi importado.');
  const keys = entries.map((entry) => entry.transactionKey).filter((value): value is string => Boolean(value));
  if (await transactionExists(context, keys)) throw new Error('Uma ou mais transações deste OFX já existem nesta conta.');
  await releaseReversedImportFingerprint(context, result.fingerprint);
  await releaseReversedTransactionKeys(context, keys);
  const importId = await saveReference(context, financeSets.imports, {
    cr40f_name: `OFX ${file.name}`,
    cr40f_fingerprint: result.fingerprint,
    cr40f_conta: account,
    cr40f_status: 'processing',
    'cr40f_ContaRef@odata.bind': `/cr40f_fluxocaixacontas(${accountId})`,
  });
  try {
    await request(context, `${financeSets.imports}(${importId})/cr40f_arquivoofx`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/octet-stream',
        'If-None-Match': 'null',
        'x-ms-file-name': file.name,
      },
      body: await file.arrayBuffer(),
    });
    await executeBatch(context, buildOfxBatch(importId, entries), 'Dataverse rejeitou a importação OFX atômica.');
  } catch (error) {
    await request(context, `${financeSets.imports}(${importId})`, { method: 'DELETE' }).catch(() => undefined);
    throw error;
  }
}

export async function reverseImport(context: RuntimeContext, importId: string): Promise<void> {
  if (context.mode === 'mock') return;
  const filter = encodeURIComponent(`_cr40f_importacaoref_value eq ${importId}`);
  const result = await request(
    context,
    `${entrySet}?$select=cr40f_fluxocaixalancamentoid&$filter=${filter}`,
  ).then((response) => response.json()) as { value: Array<{ cr40f_fluxocaixalancamentoid: string }> };
  await executeBatch(
    context,
    buildReverseBatch(importId, result.value.map((item) => item.cr40f_fluxocaixalancamentoid)),
    'A reversão atômica não foi gravada.',
  );
}

export function buildCategoryImportBatch(
  rows: ImportedCategory[],
  existing: FinanceReference[],
  batch = `batch_${crypto.randomUUID().replaceAll('-', '')}`,
  changeSet = `changeset_${crypto.randomUUID().replaceAll('-', '')}`,
): { batch: string; body: string } {
  if (!rows.length) throw new Error('A planilha não contém categorias.');
  const byKey = new Map(existing.map((item) => [`${item.group?.trim().toLocaleUpperCase('pt-BR')}|${item.name.trim().toLocaleUpperCase('pt-BR')}`, item]));
  const lines = [`--${batch}`, `Content-Type: multipart/mixed; boundary=${changeSet}`, ''];
  rows.forEach((row, index) => {
    const key = `${row.group.trim().toLocaleUpperCase('pt-BR')}|${row.name.trim().toLocaleUpperCase('pt-BR')}`;
    const current = byKey.get(key);
    const method = current ? 'PATCH' : 'POST';
    const target = current ? `${financeSets.categories}(${current.id})` : financeSets.categories;
    lines.push(
      `--${changeSet}`, 'Content-Type: application/http', 'Content-Transfer-Encoding: binary',
      `Content-ID: ${index + 1}`, '', `${method} /api/data/v9.2/${target} HTTP/1.1`,
      'Content-Type: application/json; charset=utf-8', '',
      JSON.stringify({ cr40f_name: row.name, cr40f_grupo: row.group, cr40f_natureza: row.nature }), '',
    );
  });
  lines.push(`--${changeSet}--`, `--${batch}--`, '');
  return { batch, body: lines.join('\r\n') };
}

export async function importCategoriesAtomically(
  context: RuntimeContext,
  rows: ImportedCategory[],
  existing: FinanceReference[],
): Promise<void> {
  await executeBatch(context, buildCategoryImportBatch(rows, existing), 'A planilha de categorias foi rejeitada.');
}

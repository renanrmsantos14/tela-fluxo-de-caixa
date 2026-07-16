import assert from 'node:assert/strict';
import test from 'node:test';
import { deleteReference, importOfxAtomically, loadDestinatarios, patchEntry, saveClassificationRule } from '../src/lib/dataverse';
import type { CashflowEntry, RuntimeContext } from '../src/types';

test('PATCH mantém Content-Type JSON ao adicionar If-Match', async () => {
  let request: RequestInit | undefined;
  Object.assign(globalThis, {
    fetch: async (_url: string, options: RequestInit) => {
      request = options;
      return new Response(null, { status: 204 });
    }
  });
  const context: RuntimeContext = { mode: 'direct', clientUrl: 'https://org.crm.dynamics.com' };
  const entry: CashflowEntry = {
    id: '11111111-1111-1111-1111-111111111111',
    etag: 'W/"10"',
    description: 'Teste',
    category: 'Teste',
    group: 'Teste',
    amount: 10,
    date: '2026-07-16',
    kind: 'actual',
    nature: 'outflow',
    status: 'pending',
    source: 'ofx'
  };

  await patchEntry(context, entry, { description: 'Atualizado' });

  const headers = new Headers(request?.headers);
  assert.equal(headers.get('Content-Type'), 'application/json; charset=utf-8');
  assert.equal(headers.get('If-Match'), 'W/"10"');
});

test('carrega somente terceiros favorecidos ativos usando metadata real', async () => {
  const calls: string[] = [];
  Object.assign(globalThis, {
    fetch: async (url: string) => {
      calls.push(url);
      return Response.json({ value: [{ cr40f_fluxocaixacontraparteid: 'recipient-1', cr40f_name: 'Ticket Log', cr40f_tipo: 'Fornecedor', cr40f_documento: '123', cr40f_chavepix: 'pix', cr40f_email: 'financeiro@ticketlog.com.br', cr40f_telefone: '11999999999', cr40f_observacao: 'Teste' }] });
    },
  });
  const result = await loadDestinatarios({ mode: 'direct', clientUrl: 'https://org.crm.dynamics.com' });
  assert.equal(result[0].name, 'Ticket Log');
  assert.equal(result[0].document, '123');
  assert.equal(result[0].type, 'Fornecedor');
  assert.match(calls.at(-1)!, /cr40f_fluxocaixacontrapartes/);
});

test('exclui registro mestre com If-Match', async () => {
  let request: RequestInit | undefined;
  Object.assign(globalThis, {
    fetch: async (_url: string, options: RequestInit) => {
      request = options;
      return new Response(null, { status: 204 });
    },
  });
  await deleteReference({ mode: 'direct', clientUrl: 'https://org.crm.dynamics.com' }, 'cr40f_fluxocaixacategorias', 'cat-1');
  assert.equal(request?.method, 'DELETE');
  assert.equal(new Headers(request?.headers).get('If-Match'), '*');
});

test('edição de regra limpa conta e favorecido opcionais', async () => {
  let body = '';
  Object.assign(globalThis, {
    fetch: async (_url: string, options: RequestInit) => {
      body = String(options.body);
      return new Response(null, { status: 204 });
    },
  });
  await saveClassificationRule({ mode: 'direct', clientUrl: 'https://org.crm.dynamics.com' }, {
    id: 'rule-1', name: 'Teste', pattern: 'TESTE', direction: 'outflow',
    categoryId: 'cat-1', categoryName: 'Categoria', group: 'Grupo', active: true,
  });
  assert.match(body, /"cr40f_ContaRef@odata.bind":null/);
  assert.match(body, /"cr40f_ContraparteRef@odata.bind":null/);
});

test('reimportação ignora lote e lançamentos já revertidos', async () => {
  const calls: Array<{ url: string; options: RequestInit }> = [];
  Object.assign(globalThis, {
    fetch: async (url: string, options: RequestInit = {}) => {
      calls.push({ url, options });
      if (options.method === 'POST' && url.endsWith('/cr40f_fluxocaixaimportacaos')) {
        return new Response(null, { status: 204, headers: { 'OData-EntityId': 'https://org.crm.dynamics.com/api/data/v9.2/cr40f_fluxocaixaimportacaos(11111111-1111-1111-1111-111111111111)' } });
      }
      if (url.includes("cr40f_fluxocaixaimportacaos?$select=cr40f_fluxocaixaimportacaoid&$filter=") && url.includes("cr40f_status%20eq%20'reversed'")) {
        return Response.json({ value: [{ cr40f_fluxocaixaimportacaoid: 'legacy-import' }] });
      }
      if (url.includes("cr40f_fluxocaixalancamentos?$select=cr40f_fluxocaixalancamentoid&$filter=") && url.includes("cr40f_status%20eq%20'reversed'")) {
        return Response.json({ value: [{ cr40f_fluxocaixalancamentoid: 'legacy-entry' }] });
      }
      return Response.json({ value: [] });
    },
  });

  await importOfxAtomically(
    { mode: 'direct', clientUrl: 'https://org.crm.dynamics.com' },
    { bankId: '341', accountId: '123', currency: 'BRL', fingerprint: 'fingerprint', transactions: [] },
    'Conta teste',
    '22222222-2222-2222-2222-222222222222',
    { name: 'teste.ofx', arrayBuffer: async () => new ArrayBuffer(0) } as File,
    [{
      id: 'entry-1', description: 'Teste', category: '', group: '', amount: 10, date: '2026-07-16',
      kind: 'actual', nature: 'outflow', status: 'pending', source: 'ofx', transactionKey: 'transaction-key',
    }],
  );

  assert.match(calls[0].url, /cr40f_status%20ne%20'reversed'/);
  assert.match(calls[1].url, /cr40f_status%20ne%20'reversed'/);
  assert.equal(calls.find((call) => call.url.endsWith('/cr40f_fluxocaixaimportacaos(legacy-import)'))?.options.body, '{"cr40f_fingerprint":null}');
  assert.equal(calls.find((call) => call.url.endsWith('/cr40f_fluxocaixalancamentos(legacy-entry)'))?.options.body, '{"cr40f_chavetransacao":null}');
});

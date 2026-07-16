import assert from 'node:assert/strict';
import test from 'node:test';
import { deleteReference, loadFavorecidos, patchEntry, saveClassificationRule } from '../src/lib/dataverse';
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
      if (url.includes('PicklistAttributeMetadata')) {
        return Response.json({ OptionSet: { Options: [{ Value: 100000000, Label: { UserLocalizedLabel: { Label: 'Ativo' } } }] } });
      }
      if (url.includes('EntityDefinitions')) {
        return Response.json({
          EntitySetName: 'cr40f_terceirofavorecidos',
          PrimaryIdAttribute: 'cr40f_terceirofavorecidoid',
          PrimaryNameAttribute: 'cr40f_name',
        });
      }
      return Response.json({ value: [{ cr40f_terceirofavorecidoid: 'fav-1', cr40f_name: 'Fallback', cr40f_nomerazaosocial: 'Ticket Log', cr40f_cpfcnpj: '123', cr40f_chavepix: 'pix', cr40f_status: 100000000 }] });
    },
  });
  const result = await loadFavorecidos({ mode: 'direct', clientUrl: 'https://org.crm.dynamics.com' });
  assert.equal(result[0].name, 'Ticket Log');
  assert.equal(result[0].document, '123');
  assert.match(calls.at(-1)!, /cr40f_status%20eq%20100000000|cr40f_status eq 100000000/);
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
  assert.match(body, /"cr40f_TerceiroFavorecidoRef@odata.bind":null/);
});

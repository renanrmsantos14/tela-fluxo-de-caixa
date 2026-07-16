import assert from 'node:assert/strict';
import test from 'node:test';
import { patchEntry } from '../src/lib/dataverse';
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
    status: 'open',
    source: 'ofx'
  };

  await patchEntry(context, entry, { description: 'Atualizado' });

  const headers = new Headers(request?.headers);
  assert.equal(headers.get('Content-Type'), 'application/json');
  assert.equal(headers.get('If-Match'), 'W/"10"');
});

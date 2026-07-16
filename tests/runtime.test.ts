import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveRuntimeContext } from '../src/lib/runtime';

test('prioriza parent.Xrm sobre window.Xrm', async () => {
  const parentXrm = { WebApi: {}, Utility: { getGlobalContext: () => ({ getClientUrl: () => 'https://parent.crm.dynamics.com' }) } };
  const localXrm = { WebApi: {}, Utility: { getGlobalContext: () => ({ getClientUrl: () => 'https://local.crm.dynamics.com' }) } };
  Object.assign(globalThis, { window: { parent: { Xrm: parentXrm }, Xrm: localXrm } });
  const result = await resolveRuntimeContext();
  assert.equal(result.mode, 'xrm');
  assert.equal(result.clientUrl, 'https://parent.crm.dynamics.com');
});

test('usa URL direta autenticada quando XRM não existe', async () => {
  Object.assign(globalThis, {
    window: { parent: null },
    location: { hostname: 'org23b93544.crm2.dynamics.com', origin: 'https://org23b93544.crm2.dynamics.com', search: '?mock=1' },
    fetch: async () => new Response('{}', { status: 200 })
  });
  (globalThis.window as { parent: unknown }).parent = globalThis.window;
  const result = await resolveRuntimeContext();
  assert.equal(result.mode, 'direct');
  assert.equal(result.clientUrl, 'https://org23b93544.crm2.dynamics.com');
});

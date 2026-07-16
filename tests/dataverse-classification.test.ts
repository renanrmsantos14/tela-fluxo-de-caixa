import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRuleValidationBatch, buildValidationBatch } from '../src/lib/dataverse';
import type { CashflowEntry, ClassificationRule } from '../src/types';

const entry: CashflowEntry = {
  id: '11111111-1111-1111-1111-111111111111',
  etag: 'W/"10"',
  description: 'PAGAMENTO TICKET LOG',
  category: 'Combustível',
  categoryId: '22222222-2222-2222-2222-222222222222',
  group: 'Custo operacional',
  amount: 8430,
  date: '2026-01-08',
  kind: 'actual',
  nature: 'outflow',
  status: 'suggested',
  source: 'ofx'
};

const rule: ClassificationRule = {
  id: '',
  name: 'Ticket Log',
  pattern: 'TICKET LOG',
  direction: 'outflow',
  accountId: '33333333-3333-3333-3333-333333333333',
  categoryId: entry.categoryId!,
  categoryName: entry.category,
  group: entry.group,
  counterpartyId: '44444444-4444-4444-4444-444444444444',
  counterpartyName: 'Ticket Log',
  active: true
};

test('monta validação em lote com ETag no mesmo changeset', () => {
  const request = buildValidationBatch([entry], '2026-01-31T12:00:00.000Z', 'batch_validate', 'changeset_validate');
  assert.equal(request.batch, 'batch_validate');
  assert.match(request.body, /Content-ID: 1/);
  assert.match(request.body, /If-Match: W\/"10"/);
  assert.match(request.body, /"cr40f_status":"validated"/);
  assert.match(request.body, /"cr40f_datavalidacao":"2026-01-31T12:00:00.000Z"/);
  assert.match(request.body, /--changeset_validate--\r\n--batch_validate--\r\n$/);
});

test('recusa validar lançamento sem ETag ou categoria', () => {
  assert.throws(() => buildValidationBatch([{ ...entry, etag: undefined }]), /ETag/);
  assert.throws(() => buildValidationBatch([{ ...entry, categoryId: undefined }]), /categoria/);
});

test('cria regra e valida lançamento no mesmo changeset', () => {
  const request = buildRuleValidationBatch(entry, rule, '2026-01-31T12:00:00.000Z', 'batch_rule', 'changeset_rule');
  assert.match(request.body, /POST \/api\/data\/v9\.2\/cr40f_fluxocaixaregras/);
  assert.match(request.body, /"cr40f_expressao":"TICKET LOG"/);
  assert.match(request.body, /"cr40f_direcao":"outflow"/);
  assert.match(request.body, /"cr40f_ativo":true/);
  assert.match(request.body, /"cr40f_TerceiroFavorecidoRef@odata.bind":"\/cr40f_terceirofavorecidos\(44444444-4444-4444-4444-444444444444\)"/);
  assert.match(request.body, /"cr40f_RegraRef@odata.bind":"\$1"/);
  assert.match(request.body, /PATCH \/api\/data\/v9\.2\/cr40f_fluxocaixalancamentos\(11111111-1111-1111-1111-111111111111\)/);
});

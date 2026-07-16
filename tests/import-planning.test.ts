import assert from 'node:assert/strict';
import test from 'node:test';
import { planOfxEntries } from '../src/lib/import-planning';
import type { ClassificationRule, FinanceReference, OfxImportResult } from '../src/types';

const account: FinanceReference = { id: 'account', name: 'Itaú principal' };
const result: OfxImportResult = {
  accountId: '123',
  bankId: '341',
  currency: 'BRL',
  fingerprint: 'fingerprint',
  transactions: [
    {
      fitId: 'fit-1',
      checkNumber: 'check-1',
      date: '2026-01-08',
      amount: -8430,
      description: 'PAGAMENTO TICKET LOG',
      memo: 'Pagamento Ticket Log 123456',
      type: 'DEBIT'
    }
  ]
};
const rule: ClassificationRule = {
  id: 'rule',
  name: 'Ticket Log',
  pattern: 'TICKET LOG',
  direction: 'outflow',
  categoryId: 'fuel',
  categoryName: 'Combustível',
  group: 'Custo operacional',
  counterpartyId: 'ticket',
  counterpartyName: 'Ticket Log',
  active: true
};

test('transforma regra encontrada em sugestão sem validar automaticamente', async () => {
  const [entry] = await planOfxEntries(result, account, [rule]);
  assert.equal(entry.status, 'suggested');
  assert.equal(entry.categoryId, 'fuel');
  assert.equal(entry.counterpartyId, 'ticket');
  assert.equal(entry.ruleId, 'rule');
  assert.equal(entry.originalMemo, 'Pagamento Ticket Log 123456');
  assert.equal(entry.checkNumber, 'check-1');
  assert.equal(entry.bankTransactionType, 'DEBIT');
});

test('mantém transação sem regra como pendente e sem categoria', async () => {
  const [entry] = await planOfxEntries(result, account, []);
  assert.equal(entry.status, 'pending');
  assert.equal(entry.categoryId, undefined);
  assert.equal(entry.ruleId, undefined);
});

test('marca conflito quando duas regras empatam', async () => {
  const [entry] = await planOfxEntries(result, account, [rule, { ...rule, id: 'rule-2', categoryId: 'other' }]);
  assert.equal(entry.status, 'pending');
  assert.equal(entry.ruleConflict, true);
});

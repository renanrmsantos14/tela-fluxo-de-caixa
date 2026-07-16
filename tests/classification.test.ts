import assert from 'node:assert/strict';
import test from 'node:test';
import { assertCategoryCompatible, matchClassificationRule, monthlyClosing, normalizeBankText } from '../src/lib/classification';
import type { CashflowEntry, ClassificationRule } from '../src/types';

const rules: ClassificationRule[] = [
  {
    id: 'global-ticket',
    name: 'Ticket Log',
    pattern: 'TICKET LOG',
    direction: 'outflow',
    categoryId: 'fuel',
    categoryName: 'Combustível',
    group: 'Custo operacional',
    active: true
  },
  {
    id: 'account-ticket',
    name: 'Ticket Log Itaú',
    pattern: 'PAGAMENTO TICKET LOG',
    direction: 'outflow',
    accountId: 'itau',
    categoryId: 'fuel',
    categoryName: 'Combustível',
    group: 'Custo operacional',
    active: true
  }
];

test('normaliza acentos, caixa e espaços do texto bancário', () => {
  assert.equal(normalizeBankText('  Pagamento   Manutenção João  '), 'PAGAMENTO MANUTENCAO JOAO');
});

test('prioriza regra da conta e depois o padrão mais específico', () => {
  const result = matchClassificationRule({
    text: 'Pagamento Ticket Log 123456',
    direction: 'outflow',
    accountId: 'itau'
  }, rules);
  assert.equal(result.status, 'matched');
  assert.equal(result.rule?.id, 'account-ticket');
});

test('não aplica regra de saída em recebimento', () => {
  const result = matchClassificationRule({
    text: 'Pagamento Ticket Log',
    direction: 'inflow',
    accountId: 'itau'
  }, rules);
  assert.equal(result.status, 'none');
});

test('empate de regras com a mesma especificidade vira conflito', () => {
  const duplicate = { ...rules[0], id: 'global-ticket-2', categoryId: 'other' };
  const result = matchClassificationRule({
    text: 'Ticket Log',
    direction: 'outflow',
    accountId: 'santander'
  }, [rules[0], duplicate]);
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.rule, undefined);
});

test('fechamento mensal considera somente validados e mantém transferência neutra', () => {
  const base: CashflowEntry = {
    id: 'entry',
    description: 'Transação',
    category: 'Categoria',
    group: 'Grupo',
    amount: 100,
    date: '2026-01-10',
    kind: 'actual',
    nature: 'outflow',
    status: 'validated',
    source: 'ofx'
  };
  const result = monthlyClosing([
    base,
    { ...base, id: 'pending', amount: 500, status: 'pending' },
    { ...base, id: 'income', amount: 300, nature: 'inflow' },
    { ...base, id: 'transfer', amount: 900, nature: 'transfer' },
    { ...base, id: 'other-month', amount: 1000, date: '2025-12-31' }
  ], '2026-01');
  assert.deepEqual(result, {
    inflow: 300,
    outflow: 100,
    net: 200,
    total: 4,
    validated: 3,
    suggested: 0,
    pending: 1,
    progress: 0.75
  });
});

test('bloqueia categoria com natureza contrária ao sinal bancário', () => {
  assert.throws(() => assertCategoryCompatible('outflow', 'inflow'), /saída/);
  assert.doesNotThrow(() => assertCategoryCompatible('outflow', 'transfer'));
  assert.doesNotThrow(() => assertCategoryCompatible('inflow', 'inflow'));
});

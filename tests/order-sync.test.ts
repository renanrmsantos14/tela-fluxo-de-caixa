import assert from 'node:assert/strict';
import test from 'node:test';
import { planOrderSync, planRecurringSync } from '../src/lib/dataverse';
import type { CashflowEntry } from '../src/types';

function order(id: string, originId: string, amount: number, status: CashflowEntry['status'] = 'open'): CashflowEntry {
  return {
    id,
    originId,
    description: `OP ${originId}`,
    category: 'Recebimentos',
    group: 'Operacional',
    amount,
    date: '2026-07-20',
    kind: 'forecast',
    nature: 'inflow',
    status,
    source: 'order',
    etag: `W/"${id}"`
  };
}

test('planeja criação, atualização e inativação de OP sem alterar conciliadas', () => {
  const persisted = [
    order('stored-a', 'A', 100),
    order('stored-c', 'C', 300),
    order('stored-d', 'D', 400, 'reconciled')
  ];
  const remote = [
    { ...order('remote-a', 'A', 125), description: 'OP A atualizada', date: '2026-07-25' },
    order('remote-b', 'B', 200)
  ];
  const plan = planOrderSync(remote, persisted);
  assert.deepEqual(plan.create.map((entry) => entry.originId), ['B']);
  assert.deepEqual(plan.update.map((item) => [item.current.originId, item.next.amount, item.next.date]), [['A', 125, '2026-07-25']]);
  assert.deepEqual(plan.ignore.map((entry) => entry.originId), ['C']);
});

test('materializa recorrências futuras e preserva ocorrências conciliadas ou passadas', () => {
  const desired = [
    { ...order('virtual-a', 'rec-a:2026-07-20', 100), source: 'recurrence' as const },
    { ...order('virtual-b', 'rec-a:2026-08-20', 100), source: 'recurrence' as const }
  ];
  const persisted: CashflowEntry[] = [
    { ...desired[0], id: 'stored-a', amount: 90, etag: 'W/"1"' },
    { ...order('stored-past', 'rec-a:2026-06-20', 100), source: 'recurrence', date: '2026-06-20' },
    { ...order('stored-future', 'rec-a:2026-09-20', 100), source: 'recurrence', date: '2026-09-20' },
    { ...order('stored-reconciled', 'rec-a:2026-10-20', 100, 'reconciled'), source: 'recurrence', date: '2026-10-20' }
  ];
  const plan = planRecurringSync(desired, persisted, '2026-07-16');
  assert.deepEqual(plan.create.map((entry) => entry.originId), ['rec-a:2026-08-20']);
  assert.deepEqual(plan.update.map((item) => [item.current.id, item.next.amount]), [['stored-a', 100]]);
  assert.deepEqual(plan.ignore.map((entry) => entry.id), ['stored-future']);
});

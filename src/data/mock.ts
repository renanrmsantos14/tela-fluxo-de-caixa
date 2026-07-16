import { addDays, dateOnly, startOfWeek } from '../lib/date';
import type { CashflowEntry } from '../types';

const monday = startOfWeek(new Date());
const day = (offset: number) => dateOnly(addDays(monday, offset));

export const mockEntries: CashflowEntry[] = [
  { id: 'op-001', description: 'OP 24071 · Atendimento executivo', category: 'Recebimentos de clientes', group: 'Operacional', amount: 18400, date: day(3), kind: 'forecast', nature: 'inflow', status: 'open', source: 'order', counterparty: 'Grupo Vértice' },
  { id: 'manual-001', description: 'Folha e benefícios', category: 'Pessoal', group: 'Administrativo', amount: 9300, date: day(4), kind: 'forecast', nature: 'outflow', status: 'open', source: 'manual' },
  { id: 'rec-001', description: 'Locação garagem', category: 'Estrutura', group: 'Administrativo', amount: 3800, date: day(8), kind: 'forecast', nature: 'outflow', status: 'open', source: 'recurrence' },
  { id: 'op-002', description: 'OP 24088 · Roadshow corporativo', category: 'Recebimentos de clientes', group: 'Operacional', amount: 26750, date: day(10), kind: 'forecast', nature: 'inflow', status: 'open', source: 'order', counterparty: 'Tenaris' },
  { id: 'manual-002', description: 'Seguro frota', category: 'Frota', group: 'Operacional', amount: 4200, date: day(12), kind: 'forecast', nature: 'outflow', status: 'open', source: 'manual' },
  { id: 'ofx-001', description: 'PIX RECEBIDO GRUPO VERTICE', category: 'Recebimentos de clientes', group: 'Operacional', amount: 18400, date: day(1), kind: 'actual', nature: 'inflow', status: 'reconciled', source: 'ofx', account: 'Itaú · 4521' },
  { id: 'ofx-002', description: 'DÉBITO AUTO POSTO CENTRAL', category: 'Combustível', group: 'Operacional', amount: 1250, date: day(2), kind: 'actual', nature: 'outflow', status: 'reconciled', source: 'ofx', account: 'Itaú · 4521' },
  { id: 'ofx-003', description: 'TED RECEBIDA', category: 'A classificar', group: 'A classificar', amount: 2300, date: day(4), kind: 'actual', nature: 'inflow', status: 'open', source: 'ofx', account: 'Itaú · 4521' },
  { id: 'ofx-004', description: 'TRANSFERÊNCIA ENTRE CONTAS', category: 'Transferências internas', group: 'Financeiro', amount: 5000, date: day(5), kind: 'actual', nature: 'transfer', status: 'reconciled', source: 'ofx', account: 'Itaú · 4521' },
  { id: 'op-003', description: 'OP 24102 · Agenda semanal', category: 'Recebimentos de clientes', group: 'Operacional', amount: 11800, date: day(18), kind: 'forecast', nature: 'inflow', status: 'open', source: 'order', counterparty: 'Apex Partners' }
];

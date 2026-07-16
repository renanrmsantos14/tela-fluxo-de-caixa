import type { CashflowEntry, ClassificationRule, FinanceReference } from '../types';

export const mockAccounts: FinanceReference[] = [
  { id: 'account-itau', name: 'Itaú · 4521', bank: 'Itaú', identifier: '4521' },
];

export const mockCategories: FinanceReference[] = [
  { id: 'cat-receipts', name: 'Recebimentos de clientes', group: 'Receita operacional', nature: 'inflow' },
  { id: 'cat-salary', name: 'Salário operacional', group: 'Custo operacional', nature: 'outflow' },
  { id: 'cat-fuel', name: 'Combustível', group: 'Custo operacional', nature: 'outflow' },
  { id: 'cat-meals', name: 'Alimentação', group: 'Despesas administrativas', nature: 'outflow' },
  { id: 'cat-transfer', name: 'Transferência interna', group: 'Financeiro', nature: 'transfer' },
];

export const mockCounterparties: FinanceReference[] = [
  { id: 'party-joao', name: 'João' },
  { id: 'party-ticket', name: 'Ticket Log' },
  { id: 'party-cl', name: 'CL' },
];

export const mockRules: ClassificationRule[] = [
  { id: 'rule-ticket', name: 'Ticket Log → Combustível', pattern: 'TICKET LOG', direction: 'outflow', categoryId: 'cat-fuel', categoryName: 'Combustível', group: 'Custo operacional', counterpartyId: 'party-ticket', counterpartyName: 'Ticket Log', active: true },
  { id: 'rule-joao', name: 'João → Salário', pattern: 'PIX 102030', direction: 'outflow', categoryId: 'cat-salary', categoryName: 'Salário operacional', group: 'Custo operacional', counterpartyId: 'party-joao', counterpartyName: 'João', active: true },
  { id: 'rule-cl', name: 'CL → Recebimentos', pattern: 'RECEBIMENTO CL', direction: 'inflow', categoryId: 'cat-receipts', categoryName: 'Recebimentos de clientes', group: 'Receita operacional', counterpartyId: 'party-cl', counterpartyName: 'CL', active: true },
];

export const mockEntries: CashflowEntry[] = [
  { id: 'ofx-1', etag: 'W/"1"', description: 'PIX 102030 JOAO', originalDescription: 'PIX 102030 JOAO', originalMemo: 'Pix enviado para João', bankTransactionType: 'DEBIT', checkNumber: '10021', fitId: 'fit-1', transactionKey: 'account-itau:fit-1', category: 'Salário operacional', categoryId: 'cat-salary', group: 'Custo operacional', counterparty: 'João', counterpartyId: 'party-joao', amount: 2000, date: '2026-07-05', originalDate: '2026-07-05', kind: 'actual', nature: 'outflow', status: 'suggested', source: 'ofx', account: 'Itaú · 4521', accountId: 'account-itau', normalizedText: 'PIX 102030 JOAO PIX ENVIADO PARA JOAO', ruleId: 'rule-joao' },
  { id: 'ofx-2', etag: 'W/"2"', description: 'PAGAMENTO TICKET LOG', originalDescription: 'PAGAMENTO TICKET LOG', originalMemo: 'Boleto Ticket Log', bankTransactionType: 'DEBIT', checkNumber: '10022', fitId: 'fit-2', transactionKey: 'account-itau:fit-2', category: 'Combustível', categoryId: 'cat-fuel', group: 'Custo operacional', counterparty: 'Ticket Log', counterpartyId: 'party-ticket', amount: 1380.44, date: '2026-07-08', originalDate: '2026-07-08', kind: 'actual', nature: 'outflow', status: 'validated', source: 'ofx', account: 'Itaú · 4521', accountId: 'account-itau', validatedAt: '2026-07-09T12:00:00Z', ruleId: 'rule-ticket' },
  { id: 'ofx-3', etag: 'W/"3"', description: 'RECEBIMENTO CL 4451', originalDescription: 'RECEBIMENTO CL 4451', originalMemo: 'Crédito de cliente CL', bankTransactionType: 'CREDIT', checkNumber: '10023', fitId: 'fit-3', transactionKey: 'account-itau:fit-3', category: 'Recebimentos de clientes', categoryId: 'cat-receipts', group: 'Receita operacional', counterparty: 'CL', counterpartyId: 'party-cl', amount: 9800, date: '2026-07-10', originalDate: '2026-07-10', kind: 'actual', nature: 'inflow', status: 'validated', source: 'ofx', account: 'Itaú · 4521', accountId: 'account-itau', validatedAt: '2026-07-10T18:00:00Z', ruleId: 'rule-cl' },
  { id: 'ofx-4', etag: 'W/"4"', description: 'PIX MERCADO CENTRAL', originalDescription: 'PIX MERCADO CENTRAL', originalMemo: 'Pagamento Pix', bankTransactionType: 'DEBIT', checkNumber: '10024', fitId: 'fit-4', transactionKey: 'account-itau:fit-4', category: '', group: '', amount: 89.9, date: '2026-07-11', originalDate: '2026-07-11', kind: 'actual', nature: 'outflow', status: 'pending', source: 'ofx', account: 'Itaú · 4521', accountId: 'account-itau', normalizedText: 'PIX MERCADO CENTRAL PAGAMENTO PIX' },
];

export const mockAudit: FinanceReference[] = [
  { id: 'audit-1', name: 'Importação OFX', action: 'Importação OFX', detail: '4 movimentações importadas.', date: '2026-07-11' },
];

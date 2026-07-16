import type { CashflowEntry, ClassificationRule, FinanceReference, OfxImportResult } from '../types';
import { matchClassificationRule, normalizeBankText } from './classification';
import { transactionKey } from './ofx';

export async function planOfxEntries(result: OfxImportResult, account: FinanceReference, rules: ClassificationRule[]): Promise<CashflowEntry[]> {
  return Promise.all(result.transactions.map(async (transaction, index) => {
    const direction = transaction.amount >= 0 ? 'inflow' as const : 'outflow' as const;
    const rawText = [transaction.name, transaction.memo].filter(Boolean).join(' ') || transaction.description;
    const match = matchClassificationRule({ text: rawText, direction, accountId: account.id }, rules);
    const matchedRule = match.status === 'matched' ? match.rule : undefined;
    return {
      id: `ofx-${result.fingerprint.slice(0, 8)}-${index}`,
      description: transaction.description,
      originalDescription: transaction.description,
      originalName: transaction.name,
      originalMemo: transaction.memo,
      bankTransactionType: transaction.type,
      checkNumber: transaction.checkNumber,
      referenceNumber: transaction.referenceNumber,
      normalizedText: normalizeBankText(rawText),
      date: transaction.date,
      originalDate: transaction.date,
      amount: Math.abs(transaction.amount),
      category: matchedRule?.categoryName ?? 'A classificar',
      categoryId: matchedRule?.categoryId,
      group: matchedRule?.group ?? 'A classificar',
      kind: 'actual',
      nature: direction,
      status: matchedRule ? 'suggested' : 'pending',
      source: 'ofx',
      account: account.name,
      accountId: account.id,
      counterparty: matchedRule?.counterpartyName,
      counterpartyId: matchedRule?.counterpartyId,
      ruleId: matchedRule?.id,
      ruleConflict: match.status === 'ambiguous',
      fitId: transaction.fitId,
      transactionKey: await transactionKey(result, transaction, account.id)
    } satisfies CashflowEntry;
  }));
}

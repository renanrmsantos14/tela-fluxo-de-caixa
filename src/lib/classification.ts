import type { CashflowEntry, ClassificationRule, EntryNature, RuleMatch } from '../types';

export function normalizeBankText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleUpperCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchClassificationRule(input: {
  text: string;
  direction: 'inflow' | 'outflow';
  accountId?: string;
}, rules: ClassificationRule[]): RuleMatch {
  const text = normalizeBankText(input.text);
  const candidates = rules
    .filter((rule) => rule.active)
    .filter((rule) => rule.direction === input.direction)
    .filter((rule) => !rule.accountId || rule.accountId === input.accountId)
    .map((rule) => ({ rule, pattern: normalizeBankText(rule.pattern) }))
    .filter((item) => item.pattern.length >= 4 && text.includes(item.pattern))
    .sort((left, right) => {
      const accountDifference = Number(Boolean(right.rule.accountId)) - Number(Boolean(left.rule.accountId));
      return accountDifference || right.pattern.length - left.pattern.length;
    });
  if (!candidates.length) return { status: 'none' };
  const first = candidates[0];
  const tied = candidates.filter((item) =>
    Boolean(item.rule.accountId) === Boolean(first.rule.accountId)
    && item.pattern.length === first.pattern.length
  );
  return tied.length === 1 ? { status: 'matched', rule: first.rule } : { status: 'ambiguous' };
}

export function monthlyClosing(entries: CashflowEntry[], month: string, accountId?: string): {
  inflow: number;
  outflow: number;
  net: number;
  total: number;
  validated: number;
  suggested: number;
  pending: number;
  progress: number;
} {
  const monthEntries = entries.filter((entry) =>
    entry.date.startsWith(month)
    && entry.status !== 'reversed'
    && (!accountId || entry.accountId === accountId)
  );
  const validatedEntries = monthEntries.filter((entry) => entry.status === 'validated');
  const inflow = validatedEntries.filter((entry) => entry.nature === 'inflow').reduce((sum, entry) => sum + entry.amount, 0);
  const outflow = validatedEntries.filter((entry) => entry.nature === 'outflow').reduce((sum, entry) => sum + entry.amount, 0);
  return {
    inflow,
    outflow,
    net: inflow - outflow,
    total: monthEntries.length,
    validated: validatedEntries.length,
    suggested: monthEntries.filter((entry) => entry.status === 'suggested').length,
    pending: monthEntries.filter((entry) => entry.status === 'pending').length,
    progress: monthEntries.length ? validatedEntries.length / monthEntries.length : 0
  };
}

export function assertCategoryCompatible(direction: 'inflow' | 'outflow', categoryNature: EntryNature): void {
  if (categoryNature === 'transfer' || categoryNature === direction) return;
  throw new Error(direction === 'outflow'
    ? 'Uma saída bancária exige categoria de saída ou transferência.'
    : 'Uma entrada bancária exige categoria de entrada ou transferência.');
}

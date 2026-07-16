import { addDays, isSameWeek, startOfWeek } from './date';
import type { CashflowEntry, ReconciliationSuggestion } from '../types';

export const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function signedAmount(entry: CashflowEntry): number {
  if (entry.nature === 'transfer') return 0;
  return entry.nature === 'inflow' ? entry.amount : -entry.amount;
}

export function included(entry: CashflowEntry): boolean {
  return entry.status !== 'ignored' && entry.status !== 'reversed' && (entry.kind === 'forecast' || entry.status === 'reconciled');
}

export function buildWeeks(anchor = new Date(), count = 26): Date[] {
  const first = startOfWeek(anchor);
  return Array.from({ length: count }, (_, index) => addDays(first, index * 7));
}

export function weeklyAmount(entries: CashflowEntry[], week: Date, category?: string): number {
  return entries.filter((entry) => included(entry) && isSameWeek(entry.date, week) && (!category || entry.category === category)).reduce((sum, entry) => sum + signedAmount(entry), 0);
}

export function total(entries: CashflowEntry[], predicate: (entry: CashflowEntry) => boolean): number {
  return entries.filter((entry) => included(entry) && predicate(entry)).reduce((sum, entry) => sum + signedAmount(entry), 0);
}

export function suggestReconciliations(entries: CashflowEntry[]): ReconciliationSuggestion[] {
  const forecasts = entries.filter((entry) => entry.kind === 'forecast' && entry.status === 'open');
  const usedForecasts = new Set<string>();
  return entries.filter((entry) => entry.kind === 'actual' && entry.status === 'open').flatMap((actual) => {
    const candidate = forecasts.find((forecast) => {
      const days = Math.abs((new Date(actual.date).getTime() - new Date(forecast.date).getTime()) / 86_400_000);
      return !usedForecasts.has(forecast.id) && forecast.nature === actual.nature && Math.abs(forecast.amount - actual.amount) < 0.01 && days <= 7;
    });
    if (!candidate) return [];
    usedForecasts.add(candidate.id);
    return [{ actual, forecast: candidate, confidence: actual.description.toLowerCase().includes(candidate.description.toLowerCase().slice(0, 8)) ? 'high' : 'medium' }];
  });
}

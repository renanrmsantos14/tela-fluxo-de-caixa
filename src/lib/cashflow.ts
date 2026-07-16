import { addDays, isSameWeek, startOfWeek } from './date';
import type { BusinessDayPolicy, CashflowEntry, CashflowMode, ReconciliationSuggestion } from '../types';

export const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function signedAmount(entry: CashflowEntry): number {
  if (entry.nature === 'transfer') return 0;
  return entry.nature === 'inflow' ? entry.amount : -entry.amount;
}

export function included(entry: CashflowEntry): boolean {
  if (entry.status === 'ignored' || entry.status === 'reversed') return false;
  return (entry.kind === 'forecast' && entry.status === 'open') || (entry.kind === 'actual' && entry.status === 'reconciled');
}

function validForecast(entry: CashflowEntry): boolean {
  return entry.kind === 'forecast' && entry.status !== 'ignored' && entry.status !== 'reversed';
}

function validActual(entry: CashflowEntry): boolean {
  return entry.kind === 'actual' && entry.status === 'reconciled';
}

export function amountForMode(entries: CashflowEntry[], mode: CashflowMode): number {
  const forecast = entries.filter(validForecast).reduce((sum, entry) => sum + signedAmount(entry), 0);
  const actual = entries.filter(validActual).reduce((sum, entry) => sum + signedAmount(entry), 0);
  if (mode === 'forecast') return forecast;
  if (mode === 'actual') return actual;
  if (mode === 'difference') return actual - forecast;
  return entries.filter(included).reduce((sum, entry) => sum + signedAmount(entry), 0);
}

export function buildWeeks(anchor = new Date(), count = 26): Date[] {
  const first = startOfWeek(anchor);
  return Array.from({ length: count }, (_, index) => addDays(first, index * 7));
}

export function buildMonths(anchor = new Date(), count = 12): Date[] {
  return Array.from({ length: count }, (_, index) => new Date(anchor.getFullYear(), anchor.getMonth() + index, 1));
}

export function monthlyAmount(entries: CashflowEntry[], month: Date, category?: string): number {
  return entries.filter((entry) => included(entry) && new Date(`${entry.date}T12:00:00`).getFullYear() === month.getFullYear() && new Date(`${entry.date}T12:00:00`).getMonth() === month.getMonth() && (!category || entry.category === category)).reduce((sum, entry) => sum + signedAmount(entry), 0);
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

function isoDate(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

function isBusinessDay(value: string, holidays: Set<string>): boolean {
  const day = new Date(`${value}T12:00:00Z`).getUTCDay();
  return day !== 0 && day !== 6 && !holidays.has(value);
}

export function adjustBusinessDate(value: string, policy: BusinessDayPolicy, holidays: string[]): string {
  if (policy === 'same') return value;
  const holidaySet = new Set(holidays);
  let date = new Date(`${value}T12:00:00Z`);
  while (!isBusinessDay(date.toISOString().slice(0, 10), holidaySet)) {
    date = new Date(date.getTime() + (policy === 'next' ? 1 : -1) * 86_400_000);
  }
  return date.toISOString().slice(0, 10);
}

export function generateRecurrenceDates(input: {
  start: string;
  end: string;
  frequency: 'weekly' | 'monthly' | 'annual' | 'custom';
  intervalDays?: number;
  businessDayPolicy?: BusinessDayPolicy;
  holidays?: string[];
}): string[] {
  const start = new Date(`${input.start}T12:00:00Z`);
  const end = new Date(`${input.end}T12:00:00Z`);
  const anchorDay = start.getUTCDate();
  const dates: string[] = [];
  let index = 0;
  while (true) {
    let candidate: Date;
    if (input.frequency === 'monthly' || input.frequency === 'annual') {
      const monthOffset = input.frequency === 'annual' ? index * 12 : index;
      const year = start.getUTCFullYear() + Math.floor((start.getUTCMonth() + monthOffset) / 12);
      const month = (start.getUTCMonth() + monthOffset) % 12;
      const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      candidate = new Date(`${isoDate(year, month, Math.min(anchorDay, lastDay))}T12:00:00Z`);
    } else {
      const interval = input.frequency === 'weekly' ? 7 : Math.max(1, input.intervalDays ?? 1);
      candidate = new Date(start.getTime() + index * interval * 86_400_000);
    }
    if (candidate > end) break;
    dates.push(adjustBusinessDate(candidate.toISOString().slice(0, 10), input.businessDayPolicy ?? 'same', input.holidays ?? []));
    index += 1;
  }
  return dates;
}

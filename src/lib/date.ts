const DAY = 86_400_000;

export function dateOnly(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(`${value.slice(0, 10)}T12:00:00`) : value;
  return date.toISOString().slice(0, 10);
}

export function startOfWeek(value: Date | string): Date {
  const date = new Date(typeof value === 'string' ? `${value.slice(0, 10)}T12:00:00` : value);
  const shift = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - shift);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * DAY);
}

export function weekLabel(value: Date): string {
  const end = addDays(value, 6);
  return `${value.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}–${end.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}`;
}

export function isSameWeek(date: string, weekStart: Date): boolean {
  const target = startOfWeek(date);
  return target.getTime() === startOfWeek(weekStart).getTime();
}

export function formatDate(value: string): string {
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR');
}

import { normalizeBankText } from './classification';
import type { EntryNature } from '../types';

export interface ImportedCategory {
  group: string;
  name: string;
  nature: EntryNature;
}

const natureMap: Record<string, EntryNature> = {
  ENTRADA: 'inflow',
  SAIDA: 'outflow',
  TRANSFERENCIA: 'transfer'
};

export function parseCategoryRows(rows: Array<Record<string, unknown>>): ImportedCategory[] {
  const result: ImportedCategory[] = [];
  const keys = new Set<string>();
  rows.forEach((row, index) => {
    const line = index + 2;
    const group = String(row.Grupo ?? '').trim();
    const name = String(row.Categoria ?? '').trim();
    const natureLabel = normalizeBankText(String(row.Natureza ?? ''));
    if (!group) throw new Error(`Linha ${line}: Grupo é obrigatório.`);
    if (!name) throw new Error(`Linha ${line}: Categoria é obrigatória.`);
    const nature = natureMap[natureLabel];
    if (!nature) throw new Error(`Linha ${line}: Natureza deve ser Entrada, Saída ou Transferência.`);
    const key = `${normalizeBankText(group)}|${normalizeBankText(name)}`;
    if (keys.has(key)) throw new Error(`Linha ${line}: categoria duplicada no mesmo grupo.`);
    keys.add(key);
    result.push({ group, name, nature });
  });
  if (!result.length) throw new Error('A planilha não contém categorias.');
  return result;
}

import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { parseCategoryRows } from '../src/lib/category-import';

test('valida e normaliza linhas importadas da DRE', () => {
  const result = parseCategoryRows([
    { Grupo: 'Custo operacional', Categoria: 'Combustível', Natureza: 'Saída' },
    { Grupo: 'Receitas', Categoria: 'Receita de serviços', Natureza: 'Entrada' },
    { Grupo: 'Financeiro', Categoria: 'Transferência interna', Natureza: 'Transferência' }
  ]);
  assert.deepEqual(result.map((item) => item.nature), ['outflow', 'inflow', 'transfer']);
});

test('rejeita todo o arquivo quando existe linha inválida', () => {
  assert.throws(() => parseCategoryRows([
    { Grupo: 'Custo operacional', Categoria: 'Combustível', Natureza: 'Saída' },
    { Grupo: '', Categoria: 'Inválida', Natureza: 'Saída' }
  ]), /Linha 3.*Grupo/);
});

test('bloqueia categoria duplicada no mesmo grupo', () => {
  assert.throws(() => parseCategoryRows([
    { Grupo: 'Custo operacional', Categoria: 'Combustível', Natureza: 'Saída' },
    { Grupo: ' custo operacional ', Categoria: 'COMBUSTÍVEL', Natureza: 'Saída' }
  ]), /duplicada/i);
});

test('biblioteca XLSX lê as três colunas exigidas no navegador', async () => {
  const source = new ExcelJS.Workbook();
  const sheet = source.addWorksheet('DRE');
  sheet.addRow(['Grupo', 'Categoria', 'Natureza']);
  sheet.addRow(['Custo operacional', 'Combustível', 'Saída']);
  const buffer = await source.xlsx.writeBuffer();
  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(buffer);
  assert.deepEqual((loaded.worksheets[0].getRow(2).values as unknown[]).slice(1), ['Custo operacional', 'Combustível', 'Saída']);
});

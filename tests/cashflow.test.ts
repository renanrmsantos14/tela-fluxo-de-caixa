import assert from 'node:assert/strict';
import test from 'node:test';
import { parseOfx, parseOfxDate } from '../src/lib/ofx';
import { buildWeeks, signedAmount, suggestReconciliations, weeklyAmount } from '../src/lib/cashflow';
import { buildOfxBatch } from '../src/lib/dataverse';
import type { CashflowEntry } from '../src/types';

const forecast: CashflowEntry = { id: 'forecast', description: 'Recebimento Grupo', category: 'Clientes', group: 'Operacional', amount: 1200, date: '2026-07-13', kind: 'forecast', nature: 'inflow', status: 'open', source: 'order' };
const actual: CashflowEntry = { ...forecast, id: 'actual', description: 'PIX RECEBIDO GRUPO', kind: 'actual', status: 'open', source: 'ofx' };

test('lê OFX SGML e normaliza data e valor', async () => {
  const result = await parseOfx(`<OFX><CURDEF>BRL<BANKACCTFROM><BANKID>341<ACCTID>4521<BANKTRANLIST><STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260715120000[-3]<TRNAMT>1250.30<FITID>abc-1<NAME>PIX RECEBIDO</STMTTRN></BANKTRANLIST></OFX>`);
  assert.equal(result.currency, 'BRL');
  assert.equal(result.accountId, '4521');
  assert.deepEqual(result.transactions[0], { fitId: 'abc-1', date: '2026-07-15', amount: 1250.3, description: 'PIX RECEBIDO', memo: undefined, type: 'CREDIT' });
  assert.equal(parseOfxDate('20260101'), '2026-01-01');
});

test('agrega por semana segunda-domingo e preserva sinal', () => {
  const debit: CashflowEntry = { ...forecast, id: 'debit', amount: 300, nature: 'outflow', date: '2026-07-17' };
  assert.equal(signedAmount(debit), -300);
  assert.equal(weeklyAmount([forecast, debit], new Date('2026-07-13T12:00:00')), 900);
  assert.equal(buildWeeks(new Date('2026-07-15T12:00:00'), 2)[0].toISOString().slice(0, 10), '2026-07-13');
});

test('sugere somente conciliação 1:1 no mesmo sentido e até sete dias', () => {
  const secondActual = { ...actual, id: 'actual-2' };
  const result = suggestReconciliations([forecast, actual, secondActual]);
  assert.equal(result.length, 1);
  assert.equal(result[0].forecast.id, 'forecast');
});

test('monta change set OFX atômico no formato multipart aceito pelo Dataverse', () => {
  const { batch, body } = buildOfxBatch('11111111-1111-1111-1111-111111111111', [actual], 'batch_test', 'changeset_test');
  assert.equal(batch, 'batch_test');
  assert.match(body, /Content-Type: multipart\/mixed; boundary="changeset_test"/);
  assert.match(body, /Content-ID: 1/);
  assert.match(body, /Content-Type: application\/json;type=entry/);
  assert.match(body, /--changeset_test--\r\n--batch_test--\r\n$/);
});

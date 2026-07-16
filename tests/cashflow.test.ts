import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeOfxBytes, parseOfx, parseOfxDate, transactionKey } from '../src/lib/ofx';
import { adjustBusinessDate, amountForMode, buildWeeks, generateRecurrenceDates, signedAmount, suggestReconciliations, weeklyAmount } from '../src/lib/cashflow';
import { buildOfxBatch, buildReconciliationBatch, buildReverseBatch } from '../src/lib/dataverse';
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

test('consolidado substitui previsão conciliada pelo realizado sem dupla contagem', () => {
  const reconciledForecast = { ...forecast, status: 'reconciled' as const, reconciledWithId: 'actual' };
  const reconciledActual = { ...actual, status: 'reconciled' as const, reconciledWithId: 'forecast' };
  assert.equal(amountForMode([reconciledForecast, reconciledActual], 'all'), 1200);
  assert.equal(amountForMode([reconciledForecast, reconciledActual], 'forecast'), 1200);
  assert.equal(amountForMode([reconciledForecast, reconciledActual], 'actual'), 1200);
  assert.equal(amountForMode([reconciledForecast, reconciledActual], 'difference'), 0);
});

test('recorrência mensal preserva fim do mês e ajusta próximo dia útil', () => {
  const dates = generateRecurrenceDates({
    start: '2026-01-31',
    end: '2026-04-30',
    frequency: 'monthly',
    businessDayPolicy: 'next',
    holidays: ['2026-03-02']
  });
  assert.deepEqual(dates, ['2026-02-02', '2026-03-03', '2026-03-31', '2026-04-30']);
  assert.equal(adjustBusinessDate('2026-07-18', 'previous', []), '2026-07-17');
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

test('lê OFX 2.x XML em Windows-1252 e gera chave estável por FITID', async () => {
  const source = `OFXHEADER:100\nENCODING:WINDOWS-1252\n<OFX><CURDEF>BRL</CURDEF><BANKID>341</BANKID><ACCTID>4521</ACCTID><BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260715120000[-3]</DTPOSTED><TRNAMT>-42.50</TRNAMT><FITID>fit-ç-1</FITID><NAME>Manutenção</NAME></STMTTRN></BANKTRANLIST></OFX>`;
  const bytes = Uint8Array.from([...source].map((character) => character === 'ç' ? 0xe7 : character === 'ã' ? 0xe3 : character.charCodeAt(0)));
  const decoded = decodeOfxBytes(bytes);
  const result = await parseOfx(decoded);
  assert.equal(result.transactions[0].description, 'Manutenção');
  assert.equal(await transactionKey(result, result.transactions[0], 'account-guid'), await transactionKey(result, { ...result.transactions[0], description: 'texto alterado' }, 'account-guid'));
});

test('monta reversão de lote em um único changeset', () => {
  const request = buildReverseBatch('22222222-2222-2222-2222-222222222222', [
    '11111111-1111-1111-1111-111111111111',
    '33333333-3333-3333-3333-333333333333'
  ], ['44444444-4444-4444-4444-444444444444'], 'batch_reverse', 'changeset_reverse');
  assert.match(request.body, /PATCH \/api\/data\/v9\.2\/cr40f_fluxocaixalancamentos\(11111111-1111-1111-1111-111111111111\)/);
  assert.match(request.body, /PATCH \/api\/data\/v9\.2\/cr40f_fluxocaixalancamentos\(44444444-4444-4444-4444-444444444444\)/);
  assert.match(request.body, /"cr40f_status":"open"/);
  assert.match(request.body, /"cr40f_ConciliadoCom@odata.bind":null/);
  assert.match(request.body, /PATCH \/api\/data\/v9\.2\/cr40f_fluxocaixaimportacaos\(22222222-2222-2222-2222-222222222222\)/);
  assert.match(request.body, /--changeset_reverse--\r\n--batch_reverse--\r\n$/);
});

test('monta conciliação 1:1 com Content-ID e ETag no mesmo changeset', () => {
  const reconciledActual = { ...actual, id: '11111111-1111-1111-1111-111111111111', etag: 'W/"10"' };
  const reconciledForecast = { ...forecast, id: '22222222-2222-2222-2222-222222222222', etag: 'W/"20"' };
  const request = buildReconciliationBatch(reconciledActual, reconciledForecast, 'batch_reconcile', 'changeset_reconcile');
  assert.match(request.body, /Content-ID: 1/);
  assert.match(request.body, /Content-ID: 2/);
  assert.match(request.body, /If-Match: W\/"10"/);
  assert.match(request.body, /If-Match: W\/"20"/);
  assert.match(request.body, /--changeset_reconcile--\r\n--batch_reconcile--\r\n$/);
});

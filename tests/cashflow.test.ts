import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOfxBatch, buildReverseBatch } from '../src/lib/dataverse';
import {
  decodeOfxBytes, findOfxAccount, ofxAccountDraft, parseOfx, parseOfxDate, transactionKey,
} from '../src/lib/ofx';
import type { CashflowEntry } from '../src/types';

const actual: CashflowEntry = {
  id: 'actual',
  description: 'PIX RECEBIDO GRUPO',
  category: '',
  group: '',
  amount: 1200,
  date: '2026-07-13',
  kind: 'actual',
  nature: 'inflow',
  status: 'pending',
  source: 'ofx',
};

test('lê OFX SGML e normaliza data e valor', async () => {
  const result = await parseOfx('<OFX><CURDEF>BRL<BANKACCTFROM><BANKID>341<ACCTID>4521<BANKTRANLIST><STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260715120000[-3]<TRNAMT>1250.30<FITID>abc-1<NAME>PIX RECEBIDO</STMTTRN></BANKTRANLIST></OFX>');
  assert.equal(result.currency, 'BRL');
  assert.equal(result.accountId, '4521');
  assert.deepEqual(result.transactions[0], { fitId: 'abc-1', checkNumber: undefined, referenceNumber: undefined, date: '2026-07-15', amount: 1250.3, description: 'PIX RECEBIDO', name: 'PIX RECEBIDO', memo: undefined, type: 'CREDIT' });
  assert.equal(parseOfxDate('20260101'), '2026-01-01');
});

test('lê OFX 2.x Windows-1252 e gera chave estável por FITID', async () => {
  const source = 'OFXHEADER:100\nENCODING:WINDOWS-1252\n<OFX><CURDEF>BRL</CURDEF><BANKID>341</BANKID><ACCTID>4521</ACCTID><BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260715120000[-3]</DTPOSTED><TRNAMT>-42.50</TRNAMT><FITID>fit-ç-1</FITID><NAME>Manutenção</NAME></STMTTRN></BANKTRANLIST></OFX>';
  const bytes = Uint8Array.from([...source].map((character) => character === 'ç' ? 0xe7 : character === 'ã' ? 0xe3 : character.charCodeAt(0)));
  const result = await parseOfx(decodeOfxBytes(bytes));
  assert.equal(result.transactions[0].description, 'Manutenção');
  assert.equal(await transactionKey(result, result.transactions[0], 'account-guid'), await transactionKey(result, { ...result.transactions[0], description: 'alterado' }, 'account-guid'));
});

test('prefere UTF-8 válido mesmo quando o cabeçalho declara 1252', () => {
  const source = 'OFXHEADER:100\nENCODING:USASCII\nCHARSET:1252\n<OFX><MEMO>Manutenção</MEMO></OFX>';
  assert.match(decodeOfxBytes(new TextEncoder().encode(source)), /Manutenção/);
});

test('preserva NAME, MEMO, TRNTYPE, CHECKNUM e REFNUM', async () => {
  const result = await parseOfx('<OFX><CURDEF>BRL<BANKACCTFROM><BANKID>341<ACCTID>123<BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260105120000[-3]<TRNAMT>-10<FITID>fit-1<CHECKNUM>check-1<REFNUM>ref-1<NAME>Pix enviado<MEMO>Pix enviado para João</STMTTRN></BANKTRANLIST></OFX>');
  assert.equal(result.transactions[0].name, 'Pix enviado');
  assert.equal(result.transactions[0].memo, 'Pix enviado para João');
  assert.equal(result.transactions[0].type, 'DEBIT');
  assert.equal(result.transactions[0].checkNumber, 'check-1');
  assert.equal(result.transactions[0].referenceNumber, 'ref-1');
});

test('identifica automaticamente a conta por BANKID e ACCTID', () => {
  const accounts = [
    { id: 'wrong-bank', name: 'Outra conta', bank: '033', identifier: '4521' },
    { id: 'matched', name: 'Itaú principal', bank: '341', identifier: '4521' },
  ];
  assert.equal(findOfxAccount(accounts, { bankId: '341', accountId: '4521' })?.id, 'matched');
});

test('sugere cadastro de conta preenchido com os dados do OFX', () => {
  assert.deepEqual(ofxAccountDraft({ bankId: '341', accountId: '0004521' }), {
    name: 'Banco 341 · Conta 0004521',
    bank: '341',
    identifier: '0004521',
  });
});

test('monta importação OFX atômica aceita pelo Dataverse', () => {
  const request = buildOfxBatch('11111111-1111-1111-1111-111111111111', [actual], 'batch_test', 'changeset_test');
  assert.match(request.body, /Content-Type: multipart\/mixed; boundary=changeset_test/);
  assert.match(request.body, /Content-Type: application\/json; charset=utf-8/);
  assert.match(request.body, /--changeset_test--\r\n--batch_test--\r\n$/);
});

test('monta reversão do lote completo em um changeset', () => {
  const request = buildReverseBatch('22222222-2222-2222-2222-222222222222', ['11111111-1111-1111-1111-111111111111'], [], 'batch_reverse', 'changeset_reverse');
  assert.match(request.body, /"cr40f_status":"reversed"/);
  assert.match(request.body, /cr40f_fluxocaixaimportacaos\(22222222-2222-2222-2222-222222222222\)/);
  assert.match(request.body, /--changeset_reverse--\r\n--batch_reverse--\r\n$/);
});

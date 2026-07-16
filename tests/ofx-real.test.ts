import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { decodeOfxBytes, parseOfx } from '../src/lib/ofx';

const path = process.env.OFX_SAMPLE_PATH;

test('analisa o OFX real informado sem expor seu conteúdo', { skip: !path || !existsSync(path) }, async () => {
  const result = await parseOfx(decodeOfxBytes(new Uint8Array(readFileSync(path!))));
  assert.equal(result.transactions.length, 130);
  assert.equal(result.transactions[0].name, undefined);
  assert.ok(result.transactions.every((item) => item.memo && item.checkNumber && item.fitId));
  assert.equal(result.transactions.map((item) => item.date).sort()[0], '2025-12-31');
  assert.equal(result.transactions.map((item) => item.date).sort().at(-1), '2026-01-30');
});

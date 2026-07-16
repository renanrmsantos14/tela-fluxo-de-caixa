import type { FinanceReference, OfxImportResult, OfxTransaction } from '../types';

function normalizedAccountCode(value: string | undefined): string {
  return (value ?? '').trim().toLocaleUpperCase('pt-BR');
}

export function findOfxAccount(
  accounts: FinanceReference[],
  ofx: Pick<OfxImportResult, 'accountId' | 'bankId'>,
): FinanceReference | undefined {
  const accountId = normalizedAccountCode(ofx.accountId);
  const bankId = normalizedAccountCode(ofx.bankId);
  if (!accountId) return undefined;
  return accounts.find((account) =>
    normalizedAccountCode(account.identifier) === accountId
    && (!bankId || normalizedAccountCode(account.bank) === bankId)
  );
}

export function ofxAccountDraft(
  ofx: Pick<OfxImportResult, 'accountId' | 'bankId'>,
): { name: string; bank: string; identifier: string } {
  const bank = (ofx.bankId ?? '').trim();
  const identifier = (ofx.accountId ?? '').trim();
  return {
    name: [bank && `Banco ${bank}`, identifier && `Conta ${identifier}`].filter(Boolean).join(' · '),
    bank,
    identifier,
  };
}

function tag(content: string, name: string): string | undefined {
  const closed = new RegExp(`<${name}[^>]*>\\s*([^<\\r\\n]+)\\s*</${name}>`, 'i').exec(content);
  const sgml = new RegExp(`<${name}[^>]*>\\s*([^<\\r\\n]+)`, 'i').exec(content);
  return (closed?.[1] ?? sgml?.[1])?.trim();
}

export function parseOfxDate(value: string): string {
  const match = /^(\d{4})(\d{2})(\d{2})/.exec(value.trim());
  if (!match) throw new Error(`Data OFX inválida: ${value}`);
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export async function fingerprintOfx(source: string): Promise<string> {
  const bytes = new TextEncoder().encode(source.replace(/\r\n/g, '\n').trim());
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function decodeOfxBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

async function sha256(value: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function transactionKey(result: OfxImportResult, transaction: OfxTransaction, accountId: string): Promise<string> {
  const identity = transaction.fitId?.trim()
    ? `${accountId}|fitid|${transaction.fitId.trim()}`
    : `${accountId}|fallback|${result.bankId ?? ''}|${result.accountId ?? ''}|${transaction.date}|${transaction.amount.toFixed(2)}|${transaction.description.trim().toLocaleLowerCase('pt-BR')}`;
  return sha256(identity);
}

export async function parseOfx(source: string): Promise<OfxImportResult> {
  const blocks = source.match(/<STMTTRN>[\s\S]*?(?=<STMTTRN>|<\/BANKTRANLIST>|$)/gi) ?? [];
  const transactions: OfxTransaction[] = blocks.map((block, index) => {
    const rawDate = tag(block, 'DTPOSTED');
    const rawAmount = tag(block, 'TRNAMT');
    if (!rawDate || !rawAmount) throw new Error(`Transação OFX ${index + 1} sem data ou valor.`);
    const amount = Number(rawAmount.replace(',', '.'));
    if (!Number.isFinite(amount)) throw new Error(`Valor OFX inválido na transação ${index + 1}.`);
    return {
      fitId: tag(block, 'FITID'),
      checkNumber: tag(block, 'CHECKNUM'),
      referenceNumber: tag(block, 'REFNUM'),
      date: parseOfxDate(rawDate),
      amount,
      description: tag(block, 'NAME') ?? tag(block, 'MEMO') ?? 'Transação sem descrição',
      name: tag(block, 'NAME'),
      memo: tag(block, 'MEMO'),
      type: tag(block, 'TRNTYPE')
    };
  });
  if (!transactions.length) throw new Error('OFX sem transações bancárias reconhecíveis.');
  return {
    accountId: tag(source, 'ACCTID'),
    bankId: tag(source, 'BANKID'),
    currency: tag(source, 'CURDEF') ?? 'BRL',
    transactions,
    fingerprint: await fingerprintOfx(source)
  };
}

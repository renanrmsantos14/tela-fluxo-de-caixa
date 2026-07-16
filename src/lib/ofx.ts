import type { OfxImportResult, OfxTransaction } from '../types';

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
  const header = new TextDecoder('latin1').decode(bytes.slice(0, Math.min(bytes.length, 512)));
  const declared = /ENCODING\s*:\s*([^\r\n]+)/i.exec(header)?.[1]?.trim().toLowerCase();
  const encoding = declared?.includes('1252') || declared?.includes('windows') || declared?.includes('latin') || declared?.includes('iso-8859-1')
    ? 'windows-1252'
    : 'utf-8';
  return new TextDecoder(encoding).decode(bytes);
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
      date: parseOfxDate(rawDate),
      amount,
      description: tag(block, 'NAME') ?? tag(block, 'MEMO') ?? 'Transação sem descrição',
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

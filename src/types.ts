export type RuntimeMode = 'xrm' | 'direct' | 'mock';
export type EntryNature = 'inflow' | 'outflow' | 'transfer';
export type ClassificationStatus = 'pending' | 'suggested' | 'validated' | 'reversed';
export type EntryStatus = ClassificationStatus;

export interface CashflowEntry {
  id: string;
  description: string;
  category: string;
  categoryId?: string;
  group: string;
  amount: number;
  date: string;
  kind: 'actual';
  nature: EntryNature;
  status: EntryStatus;
  source: 'ofx';
  account?: string;
  accountId?: string;
  counterparty?: string;
  counterpartyId?: string;
  originalDate?: string;
  originalDescription?: string;
  originalMemo?: string;
  originalName?: string;
  bankTransactionType?: string;
  checkNumber?: string;
  referenceNumber?: string;
  normalizedText?: string;
  ruleId?: string;
  ruleConflict?: boolean;
  validatedAt?: string;
  fitId?: string;
  transactionKey?: string;
  originId?: string;
  reconciledWithId?: string;
  importId?: string;
  etag?: string;
}

export interface FinanceReference {
  id: string;
  name: string;
  group?: string;
  nature?: EntryNature;
  bank?: string;
  identifier?: string;
  document?: string;
  type?: string;
  email?: string;
  phone?: string;
  notes?: string;
  amount?: number;
  category?: string;
  categoryId?: string;
  accountId?: string;
  counterpartyId?: string;
  date?: string;
  expression?: string;
  recipients?: string;
  action?: string;
  detail?: string;
  [key: string]: unknown;
}

export interface OfxTransaction {
  fitId?: string;
  date: string;
  amount: number;
  description: string;
  name?: string;
  memo?: string;
  type?: string;
  checkNumber?: string;
  referenceNumber?: string;
}

export interface OfxImportResult {
  accountId?: string;
  bankId?: string;
  currency: string;
  transactions: OfxTransaction[];
  fingerprint: string;
}

export interface RuntimeContext {
  mode: RuntimeMode;
  clientUrl?: string;
  xrm?: XrmLike;
}

export interface XrmLike {
  WebApi?: {
    retrieveMultipleRecords: (entity: string, query?: string) => Promise<{ entities: Record<string, unknown>[] }>;
    createRecord: (entity: string, data: Record<string, unknown>) => Promise<{ id: string }>;
  };
  Utility?: { getGlobalContext: () => { getClientUrl: () => string } };
}

export interface ClassificationRule {
  id: string;
  name: string;
  pattern: string;
  direction: 'inflow' | 'outflow';
  accountId?: string;
  categoryId: string;
  categoryName: string;
  group: string;
  counterpartyId?: string;
  counterpartyName?: string;
  active: boolean;
}

export interface RuleMatch {
  status: 'matched' | 'none' | 'ambiguous';
  rule?: ClassificationRule;
}

export type RuntimeMode = 'xrm' | 'direct' | 'mock';
export type EntryKind = 'forecast' | 'actual';
export type EntryNature = 'inflow' | 'outflow' | 'transfer';
export type EntryStatus = 'open' | 'reconciled' | 'ignored' | 'reversed';
export type CashflowMode = 'all' | 'forecast' | 'actual' | 'difference';
export type BusinessDayPolicy = 'same' | 'previous' | 'next';

export interface CashflowEntry {
  id: string;
  description: string;
  category: string;
  categoryId?: string;
  group: string;
  amount: number;
  date: string;
  kind: EntryKind;
  nature: EntryNature;
  status: EntryStatus;
  source: 'ofx' | 'order' | 'manual' | 'recurrence';
  account?: string;
  accountId?: string;
  counterparty?: string;
  counterpartyId?: string;
  originalDate?: string;
  originalDescription?: string;
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
  amount?: number;
  category?: string;
  categoryId?: string;
  accountId?: string;
  counterpartyId?: string;
  frequency?: 'weekly' | 'monthly' | 'annual' | 'custom';
  businessDayPolicy?: BusinessDayPolicy;
  intervalDays?: number;
  start?: string;
  end?: string;
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
  memo?: string;
  type?: string;
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

export interface ReconciliationSuggestion {
  actual: CashflowEntry;
  forecast: CashflowEntry;
  confidence: 'high' | 'medium';
}

export interface OrderMapping {
  entityLogicalName: string;
  entitySetName: string;
  amountField: string;
  idField: string;
  nameField: string;
  dueDateField: string;
  statusField: string;
  activeStatusValue: string | number | boolean;
  categoryId?: string;
  categoryName: string;
  counterpartyField?: string;
}

export interface MetadataOption {
  value: string;
  label: string;
}

export interface MetadataAttribute {
  logicalName: string;
  displayName: string;
  attributeType: string;
  options?: MetadataOption[];
}

export interface MetadataEntity {
  logicalName: string;
  entitySetName: string;
  displayName: string;
  attributes: MetadataAttribute[];
}

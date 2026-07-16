import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ExcelJS from 'exceljs';
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, Banknote, BookOpenCheck, Check,
  CheckCircle2, ChevronRight, CircleGauge, FileSpreadsheet, FileUp, Landmark,
  ListChecks, LoaderCircle, Menu, Pencil, Plus, ReceiptText, RotateCcw, Save, Search,
  Settings2, Tags, Trash2, Upload, Users, WalletCards, X,
} from 'lucide-react';
import packageInfo from '../package.json';
import './styles.css';
import { parseCategoryRows } from './lib/category-import';
import { assertCategoryCompatible, monthlyClosing, normalizeBankText } from './lib/classification';
import {
  audit, deleteReference, financeSets, importCategoriesAtomically, importOfxAtomically, listReferences,
  loadClassificationRules, loadEntries, loadFavorecidos, reverseImport, saveClassificationRule, saveReference,
  saveRuleAndValidateAtomically, validateEntriesAtomically,
} from './lib/dataverse';
import { planOfxEntries } from './lib/import-planning';
import { decodeOfxBytes, findOfxAccount, ofxAccountDraft, parseOfx } from './lib/ofx';
import { resolveRuntimeContext } from './lib/runtime';
import {
  mockAccounts, mockAudit, mockCategories, mockCounterparties, mockEntries, mockRules,
} from './data/mock';
import type {
  CashflowEntry, ClassificationRule, EntryNature, FinanceReference, OfxImportResult, RuntimeContext,
} from './types';

type View = 'closing' | 'queue' | 'accounts' | 'categories' | 'counterparties' | 'rules' | 'imports' | 'audit';
type RuntimeState = 'loading' | 'connected' | 'mock' | 'error';
type Modal = 'ofx' | 'category-xlsx' | 'category-editor' | 'rule-editor' | 'delete-category' | 'delete-rule' | null;

const build = window.__APP_BUILD_INFO ?? { version: packageInfo.version, builtAt: 'desenvolvimento' };
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const monthLabel = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const dayLabel = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
const emptyDraft = (): CashflowEntry => ({
  id: '', description: '', category: '', group: '', amount: 0, date: '',
  kind: 'actual', nature: 'outflow', status: 'pending', source: 'ofx',
});

function formatDay(date: string): string {
  return date ? dayLabel.format(new Date(`${date}T12:00:00Z`)) : '—';
}

function latestMonth(entries: CashflowEntry[]): string {
  return entries.find((entry) => entry.status !== 'reversed')?.date.slice(0, 7)
    ?? new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 7);
}

function accountMatches(account: FinanceReference | undefined, ofx: OfxImportResult | null): boolean {
  return Boolean(account && ofx && findOfxAccount([account], ofx));
}

function useDialogFocus(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    trigger.current = document.activeElement as HTMLElement;
    const element = ref.current;
    const focusable = () => [...(element?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])') ?? [])];
    focusable()[0]?.focus();
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape') close();
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('keydown', keydown);
      trigger.current?.focus();
    };
  }, [open, close]);
  return ref;
}

function App() {
  const [view, setView] = useState<View>('closing');
  const [context, setContext] = useState<RuntimeContext>({ mode: 'mock' });
  const [runtime, setRuntime] = useState<RuntimeState>('loading');
  const [runtimeError, setRuntimeError] = useState('');
  const [entries, setEntries] = useState<CashflowEntry[]>([]);
  const [accounts, setAccounts] = useState<FinanceReference[]>([]);
  const [categories, setCategories] = useState<FinanceReference[]>([]);
  const [counterparties, setCounterparties] = useState<FinanceReference[]>([]);
  const [rules, setRules] = useState<ClassificationRule[]>([]);
  const [imports, setImports] = useState<FinanceReference[]>([]);
  const [auditEvents, setAuditEvents] = useState<FinanceReference[]>([]);
  const [month, setMonth] = useState('');
  const [accountFilter, setAccountFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<CashflowEntry | null>(null);
  const [draft, setDraft] = useState<CashflowEntry>(emptyDraft);
  const [saveRule, setSaveRule] = useState(false);
  const [rulePattern, setRulePattern] = useState('');
  const [modal, setModal] = useState<Modal>(null);
  const [editingCategory, setEditingCategory] = useState<FinanceReference | null>(null);
  const [editingRule, setEditingRule] = useState<ClassificationRule | null>(null);
  const [ofx, setOfx] = useState<OfxImportResult | null>(null);
  const [ofxFile, setOfxFile] = useState<File | null>(null);
  const [importAccountId, setImportAccountId] = useState('');
  const [accountConfirmed, setAccountConfirmed] = useState(false);
  const [showAccountCreator, setShowAccountCreator] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [mobile, setMobile] = useState(() => window.innerWidth < 820);

  async function reload(resolved = context) {
    const [loadedAccounts, loadedCategories, loadedCounterparties, loadedImports, loadedAudit, loadedEntries] = await Promise.all([
      listReferences(resolved, financeSets.accounts, 'cr40f_fluxocaixacontaid,cr40f_name,cr40f_banco,cr40f_identificador'),
      listReferences(resolved, financeSets.categories, 'cr40f_fluxocaixacategoriaid,cr40f_name,cr40f_grupo,cr40f_natureza'),
      loadFavorecidos(resolved),
      listReferences(resolved, financeSets.imports, 'cr40f_fluxocaixaimportacaoid,cr40f_name,cr40f_status,_cr40f_contaref_value'),
      listReferences(resolved, financeSets.events, 'cr40f_fluxocaixaeventoid,cr40f_name,cr40f_acao,cr40f_detalhe,cr40f_data'),
      loadEntries(resolved),
    ]);
    const loadedRules = await loadClassificationRules(resolved, loadedCategories, loadedCounterparties);
    setAccounts(loadedAccounts);
    setCategories(loadedCategories);
    setCounterparties(loadedCounterparties);
    setImports(loadedImports);
    setAuditEvents(loadedAudit);
    setRules(loadedRules);
    setEntries(loadedEntries);
    setMonth((current) => current || latestMonth(loadedEntries));
  }

  useEffect(() => {
    async function hydrate() {
      try {
        const resolved = await resolveRuntimeContext();
        setContext(resolved);
        if (resolved.mode === 'mock') {
          setAccounts(mockAccounts); setCategories(mockCategories); setCounterparties(mockCounterparties);
          setRules(mockRules); setEntries(mockEntries); setAuditEvents(mockAudit); setImports([]);
          setMonth(latestMonth(mockEntries)); setRuntime('mock');
          return;
        }
        await reload(resolved);
        setRuntime('connected');
      } catch (error) {
        setRuntimeError(error instanceof Error ? error.message : 'Falha ao carregar o Dataverse.');
        setRuntime('error');
      }
    }
    void hydrate();
    const resize = () => setMobile(window.innerWidth < 820);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  const monthEntries = useMemo(() => entries.filter((entry) =>
    entry.date.startsWith(month) && (!accountFilter || entry.accountId === accountFilter) && entry.status !== 'reversed'
  ), [entries, month, accountFilter]);
  const closing = useMemo(() => monthlyClosing(entries, month, accountFilter || undefined), [entries, month, accountFilter]);
  const queue = useMemo(() => monthEntries.filter((entry) =>
    (!statusFilter || entry.status === statusFilter)
    && (!search || normalizeBankText(`${entry.description} ${entry.originalMemo ?? ''} ${entry.counterparty ?? ''}`).includes(normalizeBankText(search)))
  ), [monthEntries, statusFilter, search]);
  const breakdown = useMemo(() => {
    const map = new Map<string, { group: string; category: string; nature: EntryNature; amount: number }>();
    monthEntries.filter((entry) => entry.status === 'validated' && entry.nature !== 'transfer').forEach((entry) => {
      const key = `${entry.group}|${entry.category}|${entry.nature}`;
      const current = map.get(key) ?? { group: entry.group, category: entry.category, nature: entry.nature, amount: 0 };
      current.amount += entry.nature === 'inflow' ? entry.amount : -entry.amount;
      map.set(key, current);
    });
    return [...map.values()].sort((a, b) => a.group.localeCompare(b.group, 'pt-BR') || Math.abs(b.amount) - Math.abs(a.amount));
  }, [monthEntries]);

  function flash(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 4000);
  }

  function openEntry(entry: CashflowEntry) {
    setSelected(entry);
    setDraft({ ...entry });
    setRulePattern((entry.originalMemo || entry.originalDescription || entry.description).trim());
    setSaveRule(false);
  }

  function selectCategory(categoryId: string) {
    const category = categories.find((item) => item.id === categoryId);
    if (!category) return;
    setDraft((current) => ({
      ...current,
      categoryId: category.id,
      category: category.name,
      group: category.group ?? '',
      nature: category.nature ?? current.nature,
    }));
  }

  function selectCounterparty(counterpartyId: string) {
    const party = counterparties.find((item) => item.id === counterpartyId);
    setDraft((current) => ({ ...current, counterpartyId: party?.id, counterparty: party?.name }));
  }

  async function validateOne() {
    if (!selected) return;
    try {
      const category = categories.find((item) => item.id === draft.categoryId);
      if (!category?.nature) throw new Error('Selecione uma categoria da DRE.');
      assertCategoryCompatible(draft.nature === 'inflow' ? 'inflow' : 'outflow', category.nature);
      setBusy(true);
      if (saveRule) {
        if (normalizeBankText(rulePattern).length < 4) throw new Error('O padrão da regra precisa ter ao menos 4 caracteres.');
        const rule: ClassificationRule = {
          id: crypto.randomUUID(),
          name: `${rulePattern} → ${category.name}`,
          pattern: rulePattern,
          direction: draft.nature === 'inflow' ? 'inflow' : 'outflow',
          accountId: draft.accountId,
          categoryId: category.id,
          categoryName: category.name,
          group: category.group ?? '',
          counterpartyId: draft.counterpartyId,
          counterpartyName: draft.counterparty,
          active: true,
        };
        await saveRuleAndValidateAtomically(context, draft, rule);
      } else {
        await validateEntriesAtomically(context, [draft]);
      }
      await audit(context, saveRule ? 'Regra e classificação' : 'Classificação', `${draft.id} validado em ${category.name}.`);
      if (context.mode === 'mock') {
        setEntries((current) => current.map((item) => item.id === draft.id ? { ...draft, status: 'validated' } : item));
      } else await reload();
      setSelected(null);
      flash('Movimentação validada.');
    } catch (error) {
      flash(error instanceof Error ? error.message : 'Não foi possível validar.');
    } finally {
      setBusy(false);
    }
  }

  async function validateChecked() {
    const targets = entries.filter((entry) => checked.has(entry.id));
    try {
      if (!targets.length) throw new Error('Selecione movimentações classificadas.');
      targets.forEach((entry) => {
        const category = categories.find((item) => item.id === entry.categoryId);
        if (!category?.nature) throw new Error(`${entry.description}: categoria ausente.`);
        assertCategoryCompatible(entry.nature === 'inflow' ? 'inflow' : 'outflow', category.nature);
      });
      setBusy(true);
      await validateEntriesAtomically(context, targets);
      await audit(context, 'Classificação em lote', `${targets.length} movimentações validadas.`);
      if (context.mode === 'mock') setEntries((current) => current.map((entry) => checked.has(entry.id) ? { ...entry, status: 'validated' } : entry));
      else await reload();
      setChecked(new Set());
      flash(`${targets.length} movimentações validadas.`);
    } catch (error) {
      flash(error instanceof Error ? error.message : 'Não foi possível validar o lote.');
    } finally {
      setBusy(false);
    }
  }

  async function readOfx(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const result = await parseOfx(decodeOfxBytes(new Uint8Array(await file.arrayBuffer())));
      if (result.currency !== 'BRL') throw new Error('A V0 aceita apenas OFX em BRL.');
      const matched = findOfxAccount(accounts, result);
      setOfx(result);
      setOfxFile(file);
      setImportAccountId(matched?.id ?? '');
      setAccountConfirmed(Boolean(matched));
      setShowAccountCreator(!matched && Boolean(result.accountId));
    } catch (error) {
      flash(error instanceof Error ? error.message : 'OFX inválido.');
    }
  }

  async function createAccountFromOfx(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ofx?.accountId) return flash('O OFX não informou o identificador da conta.');
    const data = new FormData(event.currentTarget);
    const name = String(data.get('name') ?? '').trim();
    const bank = String(data.get('bank') ?? '').trim();
    const identifier = String(data.get('identifier') ?? '').trim();
    if (!name || !identifier) return flash('Informe o nome e o identificador da conta.');
    if (findOfxAccount(accounts, { bankId: bank, accountId: identifier })) {
      return flash('Esta conta já está cadastrada.');
    }
    try {
      setBusy(true);
      const id = await saveReference(context, financeSets.accounts, {
        cr40f_name: name,
        cr40f_banco: bank,
        cr40f_identificador: identifier,
      });
      const created: FinanceReference = { id, name, bank, identifier };
      setAccounts((current) => [...current, created]);
      setImportAccountId(id);
      setAccountConfirmed(accountMatches(created, ofx));
      setShowAccountCreator(false);
      try {
        await audit(context, 'Conta criada pelo OFX', `${name}: BANKID ${bank || 'não informado'} · ACCTID ${identifier}.`);
      } catch {
        // O cadastro confirmado não deve ser apresentado como falha por indisponibilidade da auditoria.
      }
      flash('Conta criada e selecionada automaticamente.');
    } catch (error) {
      flash(error instanceof Error ? error.message : 'Não foi possível criar a conta.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmOfx() {
    const account = accounts.find((item) => item.id === importAccountId);
    if (!ofx || !ofxFile || !account) return flash('Selecione a conta do OFX.');
    if (!accountMatches(account, ofx) && !accountConfirmed) return flash('Confirme que o OFX pertence à conta selecionada.');
    try {
      setBusy(true);
      const planned = await planOfxEntries(ofx, account, rules);
      await importOfxAtomically(context, ofx, account.name, account.id, ofxFile, planned);
      await audit(context, 'Importação OFX', `${ofxFile.name}: ${planned.length} movimentações.`);
      if (context.mode === 'mock') setEntries((current) => [...planned, ...current]);
      else await reload();
      setModal(null); setOfx(null); setOfxFile(null);
      flash(`${planned.length} movimentações importadas para classificação.`);
    } catch (error) {
      flash(error instanceof Error ? error.message : 'A importação não foi concluída.');
    } finally {
      setBusy(false);
    }
  }

  async function importCategoryFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      setBusy(true);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await file.arrayBuffer());
      const sheet = workbook.worksheets[0];
      if (!sheet) throw new Error('A planilha não possui uma aba.');
      const headers = (sheet.getRow(1).values as unknown[]).slice(1).map(String);
      const raw: Record<string, unknown>[] = [];
      sheet.eachRow((row, index) => {
        if (index === 1) return;
        const values = (row.values as unknown[]).slice(1);
        raw.push(Object.fromEntries(headers.map((header, position) => [header, values[position] ?? ''])));
      });
      const parsed = parseCategoryRows(raw);
      await importCategoriesAtomically(context, parsed, categories);
      await audit(context, 'Importação de categorias', `${file.name}: ${parsed.length} categorias.`);
      if (context.mode === 'mock') setCategories(parsed.map((row) => ({ id: crypto.randomUUID(), name: row.name, group: row.group, nature: row.nature })));
      else await reload();
      setModal(null);
      flash(`${parsed.length} categorias importadas.`);
    } catch (error) {
      flash(error instanceof Error ? error.message : 'A planilha foi rejeitada.');
    } finally {
      setBusy(false);
    }
  }

  async function addMaster(event: FormEvent<HTMLFormElement>, setName: string) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get('name') ?? '').trim();
    if (!name) return;
    try {
      setBusy(true);
      const body: Record<string, unknown> = { cr40f_name: name };
      if (setName === financeSets.accounts) { body.cr40f_banco = String(data.get('bank') ?? ''); body.cr40f_identificador = String(data.get('identifier') ?? ''); }
      await saveReference(context, setName, body);
      await audit(context, 'Cadastro', `${name} criado.`);
      if (context.mode !== 'mock') await reload();
      event.currentTarget.reset();
      flash('Cadastro salvo.');
    } catch (error) {
      flash(error instanceof Error ? error.message : 'Não foi possível salvar.');
    } finally { setBusy(false); }
  }

  async function saveCategoryForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get('name') ?? '').trim();
    const group = String(data.get('group') ?? '').trim();
    const nature = String(data.get('nature') ?? '') as EntryNature;
    const duplicate = categories.some((item) =>
      item.id !== editingCategory?.id
      && normalizeBankText(item.name) === normalizeBankText(name)
      && normalizeBankText(item.group ?? '') === normalizeBankText(group)
    );
    if (!name || !group || !['inflow', 'outflow', 'transfer'].includes(nature)) return flash('Preencha grupo, categoria e natureza.');
    if (duplicate) return flash('Esta categoria já existe dentro do grupo.');
    try {
      setBusy(true);
      const id = await saveReference(context, financeSets.categories, { cr40f_name: name, cr40f_grupo: group, cr40f_natureza: nature }, editingCategory?.id);
      await audit(context, editingCategory ? 'Categoria editada' : 'Categoria criada', `${group} · ${name}`);
      if (context.mode === 'mock') {
        setCategories((current) => editingCategory
          ? current.map((item) => item.id === id ? { ...item, name, group, nature } : item)
          : [...current, { id, name, group, nature }]);
      } else await reload();
      setModal(null); setEditingCategory(null); flash('Categoria salva.');
    } catch (error) { flash(error instanceof Error ? error.message : 'Não foi possível salvar a categoria.'); }
    finally { setBusy(false); }
  }

  async function removeCategory() {
    if (!editingCategory) return;
    try {
      setBusy(true);
      await deleteReference(context, financeSets.categories, editingCategory.id);
      await audit(context, 'Categoria excluída', `${editingCategory.group} · ${editingCategory.name}`);
      if (context.mode === 'mock') setCategories((current) => current.filter((item) => item.id !== editingCategory.id));
      else await reload();
      setModal(null); setEditingCategory(null); flash('Categoria excluída.');
    } catch { flash('Categoria em uso não pode ser excluída. Edite ou mantenha o registro.'); }
    finally { setBusy(false); }
  }

  async function saveRuleForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const pattern = String(data.get('pattern') ?? '').trim();
    const direction = String(data.get('direction') ?? '') as ClassificationRule['direction'];
    const category = categories.find((item) => item.id === String(data.get('categoryId') ?? ''));
    const party = counterparties.find((item) => item.id === String(data.get('counterpartyId') ?? ''));
    if (normalizeBankText(pattern).length < 4 || !category || !['inflow', 'outflow'].includes(direction)) return flash('Informe padrão, direção e categoria.');
    if (category.nature !== direction) return flash('A natureza da categoria precisa ser igual à direção da regra.');
    const rule: ClassificationRule = {
      id: editingRule?.id ?? '',
      name: `${pattern} → ${category.name}`,
      pattern,
      direction,
      accountId: String(data.get('accountId') ?? '') || undefined,
      categoryId: category.id,
      categoryName: category.name,
      group: category.group ?? '',
      counterpartyId: party?.id,
      counterpartyName: party?.name,
      active: data.get('active') === 'on',
    };
    try {
      setBusy(true);
      const id = await saveClassificationRule(context, rule);
      await audit(context, editingRule ? 'Regra editada' : 'Regra criada', `${pattern} → ${category.name}`);
      if (context.mode === 'mock') {
        setRules((current) => editingRule ? current.map((item) => item.id === id ? { ...rule, id } : item) : [...current, { ...rule, id }]);
      } else await reload();
      setModal(null); setEditingRule(null); flash('Regra salva.');
    } catch (error) { flash(error instanceof Error ? error.message : 'Não foi possível salvar a regra.'); }
    finally { setBusy(false); }
  }

  async function toggleRule(rule: ClassificationRule) {
    try {
      setBusy(true);
      await saveClassificationRule(context, { ...rule, active: !rule.active });
      await audit(context, rule.active ? 'Regra inativada' : 'Regra ativada', rule.pattern);
      if (context.mode === 'mock') setRules((current) => current.map((item) => item.id === rule.id ? { ...item, active: !item.active } : item));
      else await reload();
      flash(rule.active ? 'Regra inativada.' : 'Regra ativada.');
    } catch (error) { flash(error instanceof Error ? error.message : 'Não foi possível alterar a regra.'); }
    finally { setBusy(false); }
  }

  async function removeRule() {
    if (!editingRule) return;
    try {
      setBusy(true);
      await deleteReference(context, financeSets.rules, editingRule.id);
      await audit(context, 'Regra excluída', editingRule.pattern);
      if (context.mode === 'mock') setRules((current) => current.filter((item) => item.id !== editingRule.id));
      else await reload();
      setModal(null); setEditingRule(null); flash('Regra excluída.');
    } catch { flash('Regra já usada não pode ser excluída. Inative-a.'); }
    finally { setBusy(false); }
  }

  const closeModal = () => {
    setModal(null);
    setShowAccountCreator(false);
  };
  const closeDrawer = () => setSelected(null);
  const modalRef = useDialogFocus(Boolean(modal), closeModal);
  const drawerRef = useDialogFocus(Boolean(selected), closeDrawer);

  if (runtime === 'loading') return <Gate icon={<LoaderCircle className="spin" />} title="Carregando fechamento bancário" text="Conectando ao Dataverse e buscando os registros." />;
  if (runtime === 'error') return <Gate icon={<AlertTriangle />} title="Não foi possível abrir o app" text={runtimeError} />;

  const nav: Array<[View, string, typeof CircleGauge]> = [
    ['closing', 'Fechamento', CircleGauge], ['queue', 'Validar', ListChecks],
    ['accounts', 'Contas', Landmark], ['categories', 'Categorias DRE', Tags],
    ['counterparties', 'Destinatários', Users], ['rules', 'Regras', Settings2],
    ['imports', 'Importações', FileUp], ['audit', 'Auditoria', ReceiptText],
  ];

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><WalletCards /></span><span><strong>Betinhos</strong><small>Fechamento bancário</small></span></div>
      <nav aria-label="Navegação principal">{nav.map(([id, label, Icon]) => <button key={id} className={`nav-item ${view === id ? 'active' : ''}`} onClick={() => setView(id)}><Icon size={17} />{label}</button>)}</nav>
      <div className="sidebar-foot"><span className={`runtime-dot ${context.mode}`} />{context.mode === 'mock' ? 'Demonstração local' : 'Dataverse conectado'}<small>v{build.version}</small></div>
    </aside>
    <main className="main-content">
      <header className="topbar">
        <div><p className="eyebrow">FINANCEIRO · MOVIMENTAÇÕES REALIZADAS</p><h1>{view === 'closing' ? 'Fechamento mensal' : nav.find(([id]) => id === view)?.[1]}</h1></div>
        <div className="topbar-actions">
          <button className="button secondary" onClick={() => setView('queue')}><ListChecks size={17} />Validar pendências</button>
          <button className="button primary" onClick={() => setModal('ofx')} disabled={mobile}><Upload size={17} />Importar OFX</button>
        </div>
      </header>
      {mobile && <div className="mobile-notice"><Menu size={14} />Modo leitura. Cadastros e validações ficam disponíveis no desktop.</div>}
      {(view === 'closing' || view === 'queue') && <Filters month={month} setMonth={setMonth} account={accountFilter} setAccount={setAccountFilter} accounts={accounts} />}

      {view === 'closing' && <ClosingView closing={closing} breakdown={breakdown} pending={monthEntries.filter((entry) => entry.status !== 'validated')} openEntry={openEntry} month={month} />}
      {view === 'queue' && <QueueView entries={queue} checked={checked} setChecked={setChecked} openEntry={openEntry} status={statusFilter} setStatus={setStatusFilter} search={search} setSearch={setSearch} validate={validateChecked} busy={busy} mobile={mobile} />}
      {view === 'accounts' && <MasterView title="Contas bancárias" description="Cadastre cada conta uma vez. BANKID e ACCTID do OFX evitam importação na conta errada." items={accounts} disabled={mobile || busy} onSubmit={(event) => void addMaster(event, financeSets.accounts)} fields={<><label>Banco<input name="bank" required /></label><label>Identificador OFX (ACCTID)<input name="identifier" required /></label></>} />}
      {view === 'counterparties' && <SharedCounterpartiesView items={counterparties} />}
      {view === 'categories' && <CategoriesView categories={categories} disabled={mobile || busy} openImport={() => setModal('category-xlsx')} add={() => { setEditingCategory(null); setModal('category-editor'); }} edit={(item) => { setEditingCategory(item); setModal('category-editor'); }} remove={(item) => { setEditingCategory(item); setModal('delete-category'); }} />}
      {view === 'rules' && <RulesView rules={rules} accounts={accounts} disabled={mobile || busy} add={() => { setEditingRule(null); setModal('rule-editor'); }} edit={(item) => { setEditingRule(item); setModal('rule-editor'); }} remove={(item) => { setEditingRule(item); setModal('delete-rule'); }} toggle={(item) => void toggleRule(item)} />}
      {view === 'imports' && <ImportsView imports={imports} entries={entries} reverse={async (id) => { try { setBusy(true); await reverseImport(context, id); await audit(context, 'Reversão OFX', `Lote ${id} revertido.`); if (context.mode !== 'mock') await reload(); flash('Lote revertido integralmente.'); } catch (error) { flash(error instanceof Error ? error.message : 'Falha na reversão.'); } finally { setBusy(false); } }} disabled={mobile || busy} />}
      {view === 'audit' && <AuditView events={auditEvents} />}
      <small className="mobile-version">Versão {build.version} · {build.builtAt}</small>
    </main>
    <nav className="mobile-nav" aria-label="Navegação mobile">{nav.map(([id, label, Icon]) => <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}><Icon size={16} />{label}</button>)}</nav>

    {selected && <><button className="drawer-backdrop" aria-label="Fechar detalhes" onClick={closeDrawer} /><div className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" ref={drawerRef}>
      <header><div><p className="eyebrow">VALIDAÇÃO ASSISTIDA</p><h2 id="drawer-title">Classificar movimentação</h2></div><button className="icon-button" aria-label="Fechar" onClick={closeDrawer}><X size={18} /></button></header>
      <div className="drawer-content">
        <span className={`status-line ${draft.status}`}><CircleGauge size={15} />{draft.status === 'suggested' ? 'Sugestão pronta para revisar' : 'Sem regra encontrada'}</span>
        <h3>{draft.originalDescription || draft.description}</h3><strong className={draft.nature === 'inflow' ? 'amount' : 'amount negative'}>{draft.nature === 'inflow' ? '+' : '−'} {money.format(draft.amount)}</strong>
        <dl><div><dt>Data</dt><dd>{formatDay(draft.date)}</dd></div><div><dt>Conta</dt><dd>{draft.account}</dd></div><div><dt>TRNTYPE</dt><dd>{draft.bankTransactionType || '—'}</dd></div><div><dt>Referência</dt><dd>{draft.checkNumber || draft.referenceNumber || draft.fitId || '—'}</dd></div></dl>
        <div className="original-box"><small>MEMO ORIGINAL</small><p>{draft.originalMemo || 'Não informado pelo banco.'}</p></div>
        <div className="drawer-edit">
          <label>Categoria da DRE<select value={draft.categoryId ?? ''} onChange={(event) => selectCategory(event.target.value)} disabled={mobile}><option value="">Selecione</option>{categories.filter((item) => item.nature === draft.nature || item.nature === 'transfer').map((item) => <option key={item.id} value={item.id}>{item.group} · {item.name}</option>)}</select></label>
          <label>Destinatário (opcional)<select value={draft.counterpartyId ?? ''} onChange={(event) => selectCounterparty(event.target.value)} disabled={mobile}><option value="">Não identificar</option>{counterparties.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className="check-label"><input type="checkbox" checked={saveRule} onChange={(event) => setSaveRule(event.target.checked)} disabled={mobile} />Salvar regra para os próximos OFXs</label>
          {saveRule && <label>Padrão textual da regra<input value={rulePattern} onChange={(event) => setRulePattern(event.target.value)} disabled={mobile} /><small>A regra procura este trecho após remover acentos e normalizar espaços.</small></label>}
        </div>
      </div>
      <footer><button className="button primary" disabled={mobile || busy || !draft.categoryId} onClick={() => void validateOne()}>{busy ? <LoaderCircle className="spin" size={16} /> : saveRule ? <Save size={16} /> : <Check size={16} />}{saveRule ? 'Salvar regra e validar' : 'Validar movimentação'}</button></footer>
    </div></>}

    {modal && <div className="modal-layer"><button className="drawer-backdrop" aria-label="Fechar modal" onClick={closeModal} /><div className="modal" role="dialog" aria-modal="true" aria-label={modal === 'ofx' ? 'Importar OFX' : modal === 'category-xlsx' ? 'Importar categorias da DRE' : modal === 'delete-category' ? 'Excluir categoria' : modal === 'delete-rule' ? 'Excluir regra' : modal === 'category-editor' ? editingCategory ? 'Editar categoria' : 'Nova categoria' : editingRule ? 'Editar regra' : 'Nova regra'} ref={modalRef}>
      <header><div><p className="eyebrow">GESTÃO FINANCEIRA</p><h2>{modal === 'ofx' ? 'Importar OFX' : modal === 'category-xlsx' ? 'Importar categorias da DRE' : modal === 'delete-category' ? 'Excluir categoria' : modal === 'delete-rule' ? 'Excluir regra' : modal === 'category-editor' ? editingCategory ? 'Editar categoria' : 'Nova categoria' : editingRule ? 'Editar regra' : 'Nova regra'}</h2></div><button className="icon-button" aria-label="Fechar" onClick={closeModal}><X size={18} /></button></header>
      {modal === 'ofx' && <div>
        {!ofx ? <label className="dropzone"><FileUp size={34} /><strong>Escolha um arquivo .ofx</strong><span>SGML 1.x ou XML 2.x · UTF-8 ou Windows-1252</span><input type="file" accept=".ofx" onChange={(event) => void readOfx(event)} /></label> : <>
          <div className="import-summary"><Banknote /><div><strong>{ofx.transactions.length} movimentações</strong><small>Conta OFX {ofx.bankId || '—'} · {ofx.accountId || '—'}</small></div></div>
          {showAccountCreator ? <form className="account-suggestion" onSubmit={(event) => void createAccountFromOfx(event)}>
            <div className="account-suggestion-heading"><span><Landmark size={18} /></span><div><strong>Conta ainda não cadastrada</strong><small>Encontramos os dados bancários no OFX. Revise e confirme para criar.</small></div></div>
            <label>Nome da conta<input name="name" defaultValue={ofxAccountDraft(ofx).name} required /></label>
            <div className="form-row"><label>BANKID<input name="bank" defaultValue={ofxAccountDraft(ofx).bank} /></label><label>ACCTID<input name="identifier" defaultValue={ofxAccountDraft(ofx).identifier} required /></label></div>
            <div className="account-suggestion-actions"><button type="button" className="button ghost" onClick={() => setShowAccountCreator(false)}>Escolher conta existente</button><button className="button primary" disabled={busy}>{busy ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}Criar e usar esta conta</button></div>
          </form> : <>
            {accountMatches(accounts.find((item) => item.id === importAccountId), ofx) && <div className="account-detected"><CheckCircle2 size={17} /><span><strong>Conta identificada automaticamente</strong><small>{accounts.find((item) => item.id === importAccountId)?.name}</small></span></div>}
            <label>Conta cadastrada<select value={importAccountId} onChange={(event) => { setImportAccountId(event.target.value); setAccountConfirmed(accountMatches(accounts.find((item) => item.id === event.target.value), ofx)); }}><option value="">Selecione</option>{accounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            {!accountMatches(accounts.find((item) => item.id === importAccountId), ofx) && <><label className="warning-confirm check-label"><input type="checkbox" checked={accountConfirmed} onChange={(event) => setAccountConfirmed(event.target.checked)} />Confirmo que este OFX pertence à conta selecionada.</label>{ofx.accountId && <button type="button" className="button ghost create-account-link" onClick={() => setShowAccountCreator(true)}><Plus size={15} />Criar conta com os dados do OFX</button>}</>}
          </>}
        </>}
        {!showAccountCreator && <footer><button className="button secondary" onClick={closeModal}>Cancelar</button><button className="button primary" disabled={!ofx || !importAccountId || busy} onClick={() => void confirmOfx()}>{busy ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />}Importar</button></footer>}
      </div>}
      {modal === 'category-xlsx' && <div><p className="form-note">A primeira linha deve conter exatamente: <strong>Grupo</strong>, <strong>Categoria</strong> e <strong>Natureza</strong>. Uma linha inválida rejeita o arquivo inteiro.</p><label className="dropzone"><FileSpreadsheet size={34} /><strong>Escolha a planilha .xlsx</strong><span>Upsert por Grupo + Categoria</span><input type="file" accept=".xlsx" onChange={(event) => void importCategoryFile(event)} /></label></div>}
      {modal === 'category-editor' && <form onSubmit={(event) => void saveCategoryForm(event)}>
        <label>Grupo<input name="group" list="category-groups" defaultValue={editingCategory?.group ?? ''} required /><datalist id="category-groups">{[...new Set(categories.map((item) => item.group).filter(Boolean))].map((group) => <option key={group} value={group} />)}</datalist></label>
        <label>Categoria<input name="name" defaultValue={editingCategory?.name ?? ''} required /></label>
        <label>Natureza<select name="nature" defaultValue={editingCategory?.nature ?? 'outflow'}><option value="inflow">Entrada</option><option value="outflow">Saída</option><option value="transfer">Transferência</option></select></label>
        <footer><button type="button" className="button secondary" onClick={closeModal}>Cancelar</button><button className="button primary" disabled={busy}><Save size={16} />Salvar categoria</button></footer>
      </form>}
      {modal === 'rule-editor' && <form onSubmit={(event) => void saveRuleForm(event)}>
        <label>Padrão textual<input name="pattern" defaultValue={editingRule?.pattern ?? ''} required /><small>Use o trecho mais estável do NAME ou MEMO bancário.</small></label>
        <div className="form-row"><label>Direção<select name="direction" defaultValue={editingRule?.direction ?? 'outflow'}><option value="inflow">Entrada</option><option value="outflow">Saída</option></select></label><label>Conta<select name="accountId" defaultValue={editingRule?.accountId ?? ''}><option value="">Todas as contas</option>{accounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
        <label>Categoria<select name="categoryId" defaultValue={editingRule?.categoryId ?? ''} required><option value="">Selecione</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.group} · {item.name}</option>)}</select></label>
        <label>Terceiro favorecido<select name="counterpartyId" defaultValue={editingRule?.counterpartyId ?? ''}><option value="">Não identificar</option>{counterparties.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="check-label"><input name="active" type="checkbox" defaultChecked={editingRule?.active ?? true} />Regra ativa</label>
        <footer><button type="button" className="button secondary" onClick={closeModal}>Cancelar</button><button className="button primary" disabled={busy}><Save size={16} />Salvar regra</button></footer>
      </form>}
      {modal === 'delete-category' && <ConfirmDelete name={`${editingCategory?.group} · ${editingCategory?.name}`} warning="Categorias utilizadas por lançamentos ou regras não podem ser excluídas." busy={busy} cancel={closeModal} confirm={() => void removeCategory()} />}
      {modal === 'delete-rule' && <ConfirmDelete name={editingRule?.pattern ?? ''} warning="Regras já aplicadas em lançamentos devem ser inativadas, não excluídas." busy={busy} cancel={closeModal} confirm={() => void removeRule()} />}
    </div></div>}
    {notice && <div className="toast" role="status"><CheckCircle2 size={17} />{notice}</div>}
  </div>;
}

function Gate({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return <main className="runtime-gate"><article className="surface">{icon}<p className="eyebrow">FECHAMENTO BANCÁRIO</p><h1>{title}</h1><p>{text}</p><small>Versão {build.version}</small></article></main>;
}

function Filters({ month, setMonth, account, setAccount, accounts }: { month: string; setMonth: (value: string) => void; account: string; setAccount: (value: string) => void; accounts: FinanceReference[] }) {
  return <div className="filters surface"><span><Settings2 size={14} />Período</span><label>Mês<input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label><label>Conta<select value={account} onChange={(event) => setAccount(event.target.value)}><option value="">Todas as contas</option>{accounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>;
}

function ClosingView({ closing, breakdown, pending, openEntry, month }: { closing: ReturnType<typeof monthlyClosing>; breakdown: Array<{ group: string; category: string; nature: EntryNature; amount: number }>; pending: CashflowEntry[]; openEntry: (entry: CashflowEntry) => void; month: string }) {
  const title = month ? monthLabel.format(new Date(`${month}-01T12:00:00Z`)) : '';
  return <><section className="kpis"><Metric icon={<ArrowUpRight />} tone="success" label="Entradas validadas" value={money.format(closing.inflow)} detail={title} /><Metric icon={<ArrowDownRight />} tone="danger" label="Saídas validadas" value={money.format(closing.outflow)} detail={title} /><Metric icon={<Banknote />} tone="info" label="Resultado líquido" value={money.format(closing.net)} detail="Transferências internas neutras" /><Metric icon={<BookOpenCheck />} tone="info" label="Classificação concluída" value={`${Math.round(closing.progress * 100)}%`} detail={`${closing.validated} de ${closing.total} movimentações`} /></section>
    <section className="closing-grid"><article className="surface breakdown-card"><div className="card-heading"><div><p className="eyebrow">DRE · REALIZADO</p><h2>Valores por grupo e categoria</h2></div><span className="badge neutral">Somente validados</span></div>{breakdown.length ? <div className="breakdown-list">{breakdown.map((item) => <div key={`${item.group}-${item.category}`}><span><small>{item.group}</small><strong>{item.category}</strong></span><b className={item.amount < 0 ? 'negative' : ''}>{money.format(item.amount)}</b></div>)}</div> : <p className="empty"><BookOpenCheck size={18} />Nenhum valor validado neste período.</p>}</article>
    <article className="surface attention-card"><div className="card-heading"><div><p className="eyebrow">AÇÃO NECESSÁRIA</p><h2>Pendências do mês</h2></div><span className="badge warning">{pending.length}</span></div><div className="attention-list">{pending.slice(0, 6).map((entry) => <button key={entry.id} onClick={() => openEntry(entry)}><span className="icon-wrap">{entry.status === 'suggested' ? <Check size={15} /> : <AlertTriangle size={15} />}</span><span><strong>{entry.originalDescription || entry.description}</strong><small>{entry.status === 'suggested' ? `${entry.category} sugerida` : 'Sem regra encontrada'}</small></span><ChevronRight size={15} /></button>)}</div></article></section></>;
}

function Metric({ icon, tone, label, value, detail }: { icon: React.ReactNode; tone: string; label: string; value: string; detail: string }) {
  return <article className="surface metric"><span className={`metric-icon ${tone}`}>{icon}</span><p>{label}</p><strong>{value}</strong><small>{detail}</small></article>;
}

function QueueView({ entries, checked, setChecked, openEntry, status, setStatus, search, setSearch, validate, busy, mobile }: { entries: CashflowEntry[]; checked: Set<string>; setChecked: (value: Set<string>) => void; openEntry: (entry: CashflowEntry) => void; status: string; setStatus: (value: string) => void; search: string; setSearch: (value: string) => void; validate: () => void; busy: boolean; mobile: boolean }) {
  const eligible = entries.filter((entry) => entry.categoryId && entry.status !== 'validated');
  return <section className="surface queue-card"><div className="queue-toolbar"><div><p className="eyebrow">FILA DE VALIDAÇÃO</p><h2>Revise as sugestões antes de fechar o mês</h2></div><button className="button primary" disabled={mobile || busy || !checked.size} onClick={validate}><CheckCircle2 size={16} />Validar selecionadas ({checked.size})</button></div><div className="queue-filters"><label><Search size={15} /><input placeholder="Buscar descrição, MEMO ou destinatário" value={search} onChange={(event) => setSearch(event.target.value)} /></label><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Todos os status</option><option value="suggested">Sugestões prontas</option><option value="pending">Sem regra</option><option value="validated">Validados</option></select></div>
  <div className="queue-table"><div className="queue-head"><input aria-label="Selecionar todas classificadas" type="checkbox" checked={eligible.length > 0 && eligible.every((entry) => checked.has(entry.id))} onChange={(event) => setChecked(event.target.checked ? new Set(eligible.map((entry) => entry.id)) : new Set())} disabled={mobile} /><span>Movimentação</span><span>Data</span><span>Sugestão</span><span>Valor</span><span /></div>{entries.map((entry) => <div className="queue-row" key={entry.id}><input aria-label={`Selecionar ${entry.description}`} type="checkbox" checked={checked.has(entry.id)} disabled={mobile || !entry.categoryId || entry.status === 'validated'} onChange={(event) => { const next = new Set(checked); if (event.target.checked) next.add(entry.id); else next.delete(entry.id); setChecked(next); }} /><span><strong>{entry.originalDescription || entry.description}</strong><small>{entry.originalMemo || entry.checkNumber || entry.fitId}</small></span><span>{formatDay(entry.date)}</span><span>{entry.category ? <><strong>{entry.category}</strong><small>{entry.counterparty || 'Sem destinatário'}</small></> : <span className="badge warning">Sem regra</span>}</span><b className={entry.nature === 'outflow' ? 'negative' : ''}>{entry.nature === 'inflow' ? '+' : '−'} {money.format(entry.amount)}</b><button className="icon-button" aria-label={`Abrir ${entry.description}`} onClick={() => openEntry(entry)}><ChevronRight size={16} /></button></div>)}</div></section>;
}

function MasterView({ title, description, items, disabled, onSubmit, fields }: { title: string; description: string; items: FinanceReference[]; disabled: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void; fields: React.ReactNode }) {
  return <div className="management-grid"><form className="surface reference-form" onSubmit={onSubmit}><fieldset disabled={disabled}><p className="eyebrow">REGISTRO UNIFICADO</p><h2>Novo cadastro</h2><p className="form-note">{description}</p><div className="reference-fields"><label>Nome<input name="name" required /></label>{fields}</div><button className="button primary" type="submit"><Plus size={16} />Salvar cadastro</button></fieldset></form><section className="surface reference-list"><p className="eyebrow">CADASTRADOS</p><h2>{title}</h2>{items.map((item) => <div className="reference-row" key={item.id}><strong>{item.name}</strong><small>{item.bank || item.group || item.document || item.identifier || 'Registro ativo'}</small></div>)}</section></div>;
}

function SharedCounterpartiesView({ items }: { items: FinanceReference[] }) {
  return <section className="surface reference-list"><div className="imports-head"><div><p className="eyebrow">CADASTRO COMPARTILHADO</p><h2>Terceiros favorecidos ativos</h2><p>Fonte única: Tela Pagamento de Fornecedores. Alterações são feitas no app irmão e aparecem aqui automaticamente.</p></div><span className="badge info">{items.length} ativos</span></div><div className="shared-party-grid">{items.map((item) => <article key={item.id}><span className="icon-wrap"><Users size={15} /></span><div><strong>{item.name}</strong><small>{item.document || 'Documento não informado'} · PIX {item.identifier || 'não informado'}</small></div></article>)}</div></section>;
}

function CategoriesView({ categories, disabled, openImport, add, edit, remove }: { categories: FinanceReference[]; disabled: boolean; openImport: () => void; add: () => void; edit: (item: FinanceReference) => void; remove: (item: FinanceReference) => void }) {
  const [query, setQuery] = useState('');
  const visible = categories.filter((item) => normalizeBankText(`${item.group} ${item.name}`).includes(normalizeBankText(query)));
  const groups = [...new Set(visible.map((item) => item.group ?? 'Sem grupo'))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  return <section className="surface reference-list"><div className="imports-head"><div><p className="eyebrow">ESTRUTURA DA DRE</p><h2>Grupos e categorias</h2><p>Grupo organiza a DRE. Categoria classifica cada movimentação bancária.</p></div><div className="topbar-actions"><button className="button secondary" disabled={disabled} onClick={openImport}><FileSpreadsheet size={16} />Importar .xlsx</button><button className="button primary" disabled={disabled} onClick={add}><Plus size={16} />Nova categoria</button></div></div><label className="catalog-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar grupo ou categoria" /></label><div className="category-tree">{groups.map((group) => { const items = visible.filter((item) => (item.group ?? 'Sem grupo') === group).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')); return <details className="category-group" key={group} open><summary><span><strong>{group}</strong><small>{items.length} categorias</small></span><span className="badge neutral">{items[0]?.nature === 'inflow' ? 'Entrada' : items[0]?.nature === 'transfer' ? 'Transferência' : 'Saída'}</span></summary><div>{items.map((item) => <article key={item.id}><span className={`nature-dot ${item.nature}`} /><strong>{item.name}</strong><div className="row-actions"><button className="icon-button" aria-label={`Editar ${item.name}`} disabled={disabled} onClick={() => edit(item)}><Pencil size={15} /></button><button className="icon-button danger-action" aria-label={`Excluir ${item.name}`} disabled={disabled} onClick={() => remove(item)}><Trash2 size={15} /></button></div></article>)}</div></details>; })}</div></section>;
}

function RulesView({ rules, accounts, disabled, add, edit, remove, toggle }: { rules: ClassificationRule[]; accounts: FinanceReference[]; disabled: boolean; add: () => void; edit: (item: ClassificationRule) => void; remove: (item: ClassificationRule) => void; toggle: (item: ClassificationRule) => void }) {
  const [query, setQuery] = useState('');
  const visible = rules.filter((rule) => normalizeBankText(`${rule.pattern} ${rule.categoryName} ${rule.counterpartyName ?? ''}`).includes(normalizeBankText(query)));
  return <section className="surface reference-list"><div className="imports-head"><div><p className="eyebrow">AUTOMAÇÃO ASSISTIDA</p><h2>Regras de reconhecimento</h2><p>Regra sugere categoria e favorecido. Usuário ainda valida a movimentação.</p></div><button className="button primary" disabled={disabled} onClick={add}><Plus size={16} />Nova regra</button></div><label className="catalog-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar padrão, categoria ou favorecido" /></label><div className="rule-list">{visible.map((rule) => <article key={rule.id} className={!rule.active ? 'inactive' : ''}><span className={`rule-state ${rule.active ? 'active' : ''}`} /><div><strong>{rule.pattern}</strong><small>{rule.accountId ? accounts.find((item) => item.id === rule.accountId)?.name : 'Todas as contas'} · {rule.direction === 'inflow' ? 'Entrada' : 'Saída'}</small></div><span><strong>{rule.categoryName}</strong><small>{rule.counterpartyName || 'Sem favorecido'}</small></span><div className="row-actions"><button className="button ghost compact" disabled={disabled} onClick={() => toggle(rule)}>{rule.active ? 'Inativar' : 'Ativar'}</button><button className="icon-button" aria-label={`Editar regra ${rule.pattern}`} disabled={disabled} onClick={() => edit(rule)}><Pencil size={15} /></button><button className="icon-button danger-action" aria-label={`Excluir regra ${rule.pattern}`} disabled={disabled} onClick={() => remove(rule)}><Trash2 size={15} /></button></div></article>)}</div></section>;
}

function ConfirmDelete({ name, warning, busy, cancel, confirm }: { name: string; warning: string; busy: boolean; cancel: () => void; confirm: () => void }) {
  return <div className="confirm-delete"><span className="confirm-icon"><Trash2 size={22} /></span><h3>Excluir “{name}”?</h3><p>{warning}</p><footer><button className="button secondary" onClick={cancel}>Cancelar</button><button className="button primary danger-button" disabled={busy} onClick={confirm}><Trash2 size={16} />Excluir</button></footer></div>;
}

function ImportsView({ imports, entries, reverse, disabled }: { imports: FinanceReference[]; entries: CashflowEntry[]; reverse: (id: string) => Promise<void>; disabled: boolean }) {
  return <section className="surface reference-list"><p className="eyebrow">HISTÓRICO DE LOTES</p><h2>Importações OFX</h2>{imports.length ? imports.map((item) => <div className="import-row" key={item.id}><span><strong>{item.name}</strong><small>{entries.filter((entry) => entry.importId === item.id).length} movimentações · {String(item.status ?? 'imported')}</small></span><button className="button ghost danger-action" disabled={disabled || item.status === 'reversed'} onClick={() => void reverse(item.id)}><RotateCcw size={15} />Reverter lote</button></div>) : <p className="empty"><FileUp size={18} />Nenhuma importação registrada.</p>}</section>;
}

function AuditView({ events }: { events: FinanceReference[] }) {
  return <section className="surface audit-view"><div><p className="eyebrow">RASTREABILIDADE</p><h2>Auditoria financeira</h2><p>Importações, classificações, regras, correções e reversões.</p></div><div className="audit-list">{events.map((item) => <article key={item.id}><span className="icon-wrap"><ReceiptText size={15} /></span><div><strong>{item.action || item.name}</strong><p>{item.detail}</p></div><time>{item.date ? formatDay(item.date) : '—'}</time></article>)}</div></section>;
}

createRoot(document.getElementById('root')!).render(<App />);

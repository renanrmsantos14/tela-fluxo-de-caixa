import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import packageInfo from '../package.json';
import { ArrowDownRight, ArrowUpRight, Banknote, CalendarDays, CheckCircle2, ChevronRight, CircleAlert, Clock3, FileUp, Landmark, Menu, Plus, RefreshCw, Settings2, Sparkles, Upload, WalletCards, X, Tags, Repeat2, Building2, Undo2, Save, SlidersHorizontal, ScrollText, Users, Filter, LoaderCircle, AlertTriangle } from 'lucide-react';
import './styles.css';
import { amountForMode, buildMonths, buildWeeks, currency, suggestReconciliations, weeklyAmount } from './lib/cashflow';
import { addDays, dateOnly, formatDate, weekLabel } from './lib/date';
import { decodeOfxBytes, parseOfx, transactionKey } from './lib/ofx';
import { resolveRuntimeContext } from './lib/runtime';
import { audit, financeSets, importOfxAtomically, listCustomEntities, listReferences, loadEntityMetadata, loadEntries, loadOrderMapping, loadRecurringForecasts, patchEntry, reverseImport, saveEntry, saveReference, syncActiveOrders, updateReconciliation } from './lib/dataverse';
import { mockAccounts, mockCategories, mockCounterparties, mockEntries } from './data/mock';
import type { CashflowEntry, CashflowMode, FinanceReference, MetadataEntity, OfxImportResult, RuntimeContext } from './types';

type View = 'flow' | 'imports' | 'accounts' | 'categories' | 'counterparties' | 'recurrences' | 'audit' | 'settings';
type Modal = 'manual' | 'ofx' | null;
type RuntimeState = 'loading' | 'connected' | 'mock' | 'error';
const build = window.__APP_BUILD_INFO ?? { version: packageInfo.version, builtAt: new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(new Date()) };
function matchesOfxAccount(account: FinanceReference | undefined, ofx: OfxImportResult | null): boolean {
  if (!account || !ofx?.accountId) return false;
  return account.identifier === ofx.accountId && (!ofx.bankId || !account.bank || account.bank === ofx.bankId);
}

function App() {
  const [view, setView] = useState<View>('flow');
  const [entries, setEntries] = useState<CashflowEntry[]>([]);
  const [context, setContext] = useState<RuntimeContext>({ mode: 'mock' });
  const [runtimeState, setRuntimeState] = useState<RuntimeState>('loading');
  const [runtimeError, setRuntimeError] = useState('');
  const [selected, setSelected] = useState<CashflowEntry | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [ofx, setOfx] = useState<OfxImportResult | null>(null);
  const [ofxFile, setOfxFile] = useState<File | null>(null);
  const [accountId, setAccountId] = useState('');
  const [accountMismatchConfirmed, setAccountMismatchConfirmed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadingSync, setLoadingSync] = useState(false);
  const [mode, setMode] = useState<CashflowMode>('all');
  const [weekOffset, setWeekOffset] = useState(0);
  const [horizon, setHorizon] = useState<'weekly' | 'monthly'>('weekly');
  const [mobile, setMobile] = useState(() => window.innerWidth < 820);
  const [accounts, setAccounts] = useState<FinanceReference[]>([]);
  const [categoryCatalog, setCategoryCatalog] = useState<FinanceReference[]>([]);
  const [counterparties, setCounterparties] = useState<FinanceReference[]>([]);
  const [recurrences, setRecurrences] = useState<FinanceReference[]>([]);
  const [holidays, setHolidays] = useState<FinanceReference[]>([]);
  const [rules, setRules] = useState<FinanceReference[]>([]);
  const [auditEvents, setAuditEvents] = useState<FinanceReference[]>([]);
  const [settings, setSettings] = useState<FinanceReference | null>(null);
  const [metadataEntities, setMetadataEntities] = useState<MetadataEntity[]>([]);
  const [filterAccount, setFilterAccount] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterSource, setFilterSource] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  useEffect(() => {
    async function hydrate() {
      try {
        const resolved = await resolveRuntimeContext();
        setContext(resolved);
        if (resolved.mode === 'mock') {
          setEntries(mockEntries);
          setAccounts(mockAccounts);
          setCategoryCatalog(mockCategories);
          setCounterparties(mockCounterparties);
          setRuntimeState('mock');
          return;
        }
        const [loadedAccounts, loadedCategories, loadedCounterparties, loadedRecurrences, loadedHolidays, loadedSettings, loadedRules, loadedAuditEvents, entities] = await Promise.all([
          listReferences(resolved, financeSets.accounts, 'cr40f_fluxocaixacontaid,cr40f_name,cr40f_banco,cr40f_identificador'),
          listReferences(resolved, financeSets.categories, 'cr40f_fluxocaixacategoriaid,cr40f_name,cr40f_grupo,cr40f_natureza'),
          listReferences(resolved, 'cr40f_fluxocaixacontrapartes', 'cr40f_fluxocaixacontraparteid,cr40f_name,cr40f_documento'),
          listReferences(resolved, financeSets.recurrences, 'cr40f_fluxocaixarecorrenciaid,cr40f_name,cr40f_valor,cr40f_categoria,cr40f_natureza,cr40f_frequencia,cr40f_intervalodias,cr40f_ajustevencimento,cr40f_inicio,cr40f_fim,_cr40f_categoriaref_value,_cr40f_contraparteref_value'),
          listReferences(resolved, financeSets.holidays, 'cr40f_fluxocaixaferiadoid,cr40f_name,cr40f_data'),
          listReferences(resolved, financeSets.settings, 'cr40f_fluxocaixaconfiguracaoid,cr40f_name,cr40f_entidadeop,cr40f_campoidop,cr40f_camponomeop,cr40f_campovalorop,cr40f_campodataop,cr40f_campostatusop,cr40f_valorativoop,cr40f_categoriaop,cr40f_campocontraparteop,cr40f_destinatariosalerta,_cr40f_categoriaopref_value'),
          listReferences(resolved, financeSets.rules, 'cr40f_fluxocaixaregraid,cr40f_name,cr40f_expressao,cr40f_categoria,_cr40f_categoriaref_value'),
          listReferences(resolved, financeSets.events, 'cr40f_fluxocaixaeventoid,cr40f_name,cr40f_acao,cr40f_detalhe,cr40f_data'),
          listCustomEntities(resolved)
        ]);
        setAccounts(loadedAccounts); setCategoryCatalog(loadedCategories); setCounterparties(loadedCounterparties); setRecurrences(loadedRecurrences); setHolidays(loadedHolidays); setSettings(loadedSettings[0] ?? null); setRules(loadedRules); setAuditEvents(loadedAuditEvents); setMetadataEntities(entities);
        const mapping = await loadOrderMapping(resolved);
        if (mapping) await syncActiveOrders(resolved, mapping);
        await loadRecurringForecasts(resolved, buildWeeks(new Date(), 26).at(-1) ?? new Date(), loadedHolidays.map((holiday) => holiday.date).filter((date): date is string => Boolean(date)));
        setEntries(await loadEntries(resolved));
        setRuntimeState('connected');
      } catch (error) {
        setEntries([]);
        setRuntimeError(error instanceof Error ? error.message : 'Falha ao carregar dados do Dataverse.');
        setRuntimeState('error');
      }
    }
    void hydrate();
    const listener = () => setMobile(window.innerWidth < 820);
    window.addEventListener('resize', listener);
    return () => window.removeEventListener('resize', listener);
  }, []);

  const allWeeks = useMemo(() => buildWeeks(new Date(), 26), []);
  const weeks = useMemo(() => allWeeks.slice(weekOffset, weekOffset + 8), [allWeeks, weekOffset]);
  const filteredEntries = useMemo(() => entries.filter((entry) =>
    (!filterAccount || entry.accountId === filterAccount || entry.account === accounts.find((item) => item.id === filterAccount)?.name) &&
    (!filterCategory || entry.categoryId === filterCategory || entry.category === categoryCatalog.find((item) => item.id === filterCategory)?.name) &&
    (!filterSource || entry.source === filterSource) &&
    (!filterStatus || entry.status === filterStatus)
  ), [entries, accounts, categoryCatalog, filterAccount, filterCategory, filterSource, filterStatus]);
  const categories = useMemo(() => [...new Set(filteredEntries.filter((entry) => entry.nature !== 'transfer').map((entry) => entry.category))], [filteredEntries]);
  const currentWeek = allWeeks[0];
  const currentWeekEnd = dateOnly(addDays(currentWeek, 6));
  const currentEntries = filteredEntries.filter((entry) => entry.date >= dateOnly(currentWeek) && entry.date <= currentWeekEnd);
  const inflow = amountForMode(currentEntries.filter((entry) => entry.nature === 'inflow'), 'all');
  const outflow = Math.abs(amountForMode(currentEntries.filter((entry) => entry.nature === 'outflow'), 'all'));
  const result = amountForMode(filteredEntries, 'all');
  const projection = allWeeks.reduce((sum, week) => sum + weeklyAmount(filteredEntries, week), 0);
  const suggestions = useMemo(() => suggestReconciliations(filteredEntries), [filteredEntries]);

  function notify(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 3500);
  }

  async function persistReference(setName: string, body: Record<string, unknown>, current?: FinanceReference): Promise<FinanceReference | null> {
    try { const id = await saveReference(context, setName, body, current?.id); return { ...(current ?? {}), id, name: String(body.cr40f_name ?? current?.name ?? '') }; }
    catch (error) { notify(error instanceof Error ? error.message : 'Não foi possível gravar no Dataverse.'); return null; }
  }

  async function updateOfx(entry: CashflowEntry, description: string, date: string, categoryId: string, transfer: boolean) {
    if (entry.source !== 'ofx') return;
    const category = categoryCatalog.find((item) => item.id === categoryId);
    if (!transfer && !category) return notify('Selecione uma categoria cadastrada.');
    const next = { ...entry, description, date, category: transfer ? 'Transferências internas' : category!.name, categoryId: transfer ? categoryCatalog.find((item) => item.nature === 'transfer')?.id : categoryId, group: transfer ? 'Financeiro' : category!.group ?? entry.group, nature: transfer ? 'transfer' as const : category!.nature ?? entry.nature };
    try {
      await patchEntry(context, entry, next);
      if (!transfer && category!.name !== 'A classificar') await saveReference(context, financeSets.rules, { cr40f_name: `Regra: ${category!.name}`, cr40f_expressao: description.trim().toLocaleLowerCase('pt-BR'), cr40f_categoria: category!.name, 'cr40f_CategoriaRef@odata.bind': `/cr40f_fluxocaixacategorias(${categoryId})` });
      await audit(context, 'Edição OFX', `${entry.id}: data/descrição/categoria ajustadas`);
    }
    catch (error) { return notify(error instanceof Error ? error.message : 'Não foi possível atualizar o OFX.'); }
    setEntries((current) => current.map((item) => item.id === entry.id ? next : item)); setSelected(next); notify('OFX atualizado; original preservado na auditoria.');
  }

  async function reverseBatch(entry: CashflowEntry) {
    if (!entry.importId) return notify('Este lançamento não tem lote OFX para reverter.');
    try { await reverseImport(context, entry.importId); await audit(context, 'Reversão de lote OFX', `Importação ${entry.importId} revertida`); }
    catch (error) { return notify(error instanceof Error ? error.message : 'Não foi possível reverter o lote.'); }
    setEntries((current) => {
      const importedIds = new Set(current.filter((item) => item.importId === entry.importId).map((item) => item.id));
      return current.map((item) => item.importId === entry.importId
        ? { ...item, status: 'reversed', reconciledWithId: undefined }
        : item.reconciledWithId && importedIds.has(item.reconciledWithId)
          ? { ...item, status: 'open', reconciledWithId: undefined }
          : item);
    }); setSelected(null); notify('Lote OFX revertido com auditoria; previsões vinculadas foram reabertas.');
  }

  async function refreshOrders() {
    setLoadingSync(true);
    try {
      const orders = await syncActiveOrders(context, await loadOrderMapping(context));
      if (orders.length && context.mode !== 'mock') setEntries(await loadEntries(context));
      else if (orders.length) setEntries((current) => [...current.filter((entry) => entry.source !== 'order'), ...orders]);
      await audit(context, 'Sincronização de OPs', `${orders.length} previsões ativas sincronizadas.`).catch(() => undefined);
      notify(`${orders.length} OPs ativas sincronizadas.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Não foi possível sincronizar as OPs.');
    } finally {
      setLoadingSync(false);
    }
  }

  function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    file.arrayBuffer().then((buffer) => parseOfx(decodeOfxBytes(new Uint8Array(buffer)))).then((result) => {
      if (result.currency !== 'BRL') throw new Error('Este V0 aceita apenas OFX em BRL.');
      setOfx(result); setOfxFile(file);
      const matched = accounts.find((item) => matchesOfxAccount(item, result));
      setAccountId(matched?.id ?? '');
      setAccountMismatchConfirmed(Boolean(matched));
    }).catch((error) => notify(error instanceof Error ? error.message : 'Arquivo OFX inválido.'));
    event.target.value = '';
  }

  async function confirmOfx() {
    if (!ofx || !ofxFile) return;
    const selectedAccount = accounts.find((item) => item.id === accountId);
    if (!selectedAccount) return notify('Selecione uma conta bancária cadastrada antes de importar.');
    if (!matchesOfxAccount(selectedAccount, ofx) && !accountMismatchConfirmed) return notify('Confirme a conta quando BANKID/ACCTID do OFX não corresponderem ao cadastro.');
    const imported = await Promise.all(ofx.transactions.map(async (transaction, index): Promise<CashflowEntry> => {
      const rule = rules.find((item) => transaction.description.toLocaleLowerCase('pt-BR').includes(String(item.expression ?? '___')));
      const category = categoryCatalog.find((item) => item.id === rule?.categoryId) ?? categoryCatalog.find((item) => item.name === rule?.category) ?? categoryCatalog.find((item) => item.name === 'A classificar');
      return {
        id: `ofx-${ofx.fingerprint.slice(0, 8)}-${index}`,
        description: transaction.description,
        originalDescription: transaction.description,
        date: transaction.date,
        originalDate: transaction.date,
        amount: Math.abs(transaction.amount),
        category: category?.name ?? 'A classificar',
        categoryId: category?.id,
        group: category?.group ?? 'A classificar',
        kind: 'actual',
        nature: transaction.amount >= 0 ? 'inflow' : 'outflow',
        status: 'open',
        source: 'ofx',
        account: selectedAccount.name,
        accountId: selectedAccount.id,
        fitId: transaction.fitId,
        transactionKey: await transactionKey(ofx, transaction, selectedAccount.id)
      };
    }));
    const fitIds = imported.map((entry) => entry.fitId).filter((value): value is string => Boolean(value));
    const keys = imported.map((entry) => entry.transactionKey!);
    const duplicate = new Set(fitIds).size !== fitIds.length || new Set(keys).size !== keys.length || entries.some((entry) => (entry.fitId && fitIds.includes(entry.fitId)) || (entry.transactionKey && keys.includes(entry.transactionKey)));
    if (duplicate) return notify('Importação bloqueada: transação OFX já existe.');
    try { await importOfxAtomically(context, ofx, selectedAccount.name, selectedAccount.id, ofxFile, imported); } catch (error) { return notify(error instanceof Error ? error.message : 'Importação OFX não foi concluída.'); }
    await audit(context, 'Importação OFX', `${imported.length} transações importadas da conta ${selectedAccount.name}.`).catch(() => undefined);
    if (context.mode === 'mock') setEntries((current) => [...imported, ...current]);
    else { const latest = await loadEntries(context); setEntries((current) => [...latest, ...current.filter((entry) => entry.source === 'recurrence')]); }
    setOfx(null); setOfxFile(null); setAccountId(''); setAccountMismatchConfirmed(false); setModal(null);
    notify(`${imported.length} transações importadas. Pendentes ficam fora do cálculo até conciliação.`);
  }

  async function createManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = Number(String(form.get('amount')).replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) return notify('Informe valor válido.');
    const entry: CashflowEntry = {
      id: crypto.randomUUID(),
      description: String(form.get('description')),
      category: categoryCatalog.find((item) => item.id === String(form.get('categoryId')))?.name ?? '',
      categoryId: String(form.get('categoryId')),
      group: categoryCatalog.find((item) => item.id === String(form.get('categoryId')))?.group ?? 'Manual',
      amount: value,
      date: String(form.get('date')),
      kind: 'forecast',
      nature: categoryCatalog.find((item) => item.id === String(form.get('categoryId')))?.nature ?? String(form.get('nature')) as CashflowEntry['nature'],
      status: 'open',
      source: 'manual',
      account: accounts.find((item) => item.id === String(form.get('accountId')))?.name,
      accountId: String(form.get('accountId')),
      counterparty: counterparties.find((item) => item.id === String(form.get('counterpartyId')))?.name,
      counterpartyId: String(form.get('counterpartyId')) || undefined
    };
    try {
      if (context.mode === 'mock') setEntries((current) => [entry, ...current]);
      else { await saveEntry(context, entry); setEntries(await loadEntries(context)); }
      await audit(context, 'Previsão manual', `${entry.description} criada para ${entry.date}.`).catch(() => undefined);
    } catch (error) { return notify(error instanceof Error ? error.message : 'Previsão não foi gravada no Dataverse.'); }
    setModal(null); notify('Previsão manual criada.');
  }

  async function reconcile(actualId: string, forecastId: string) {
    if (mobile) return;
    const actual = entries.find((entry) => entry.id === actualId);
    const forecast = entries.find((entry) => entry.id === forecastId);
    if (!actual || !forecast || actual.kind !== 'actual' || forecast.kind !== 'forecast' || actual.status !== 'open' || forecast.status !== 'open') return notify('Conciliação indisponível para estes lançamentos.');
    try { await updateReconciliation(context, actual, forecast); await audit(context, 'Conciliação 1:1', `${actual.description} conciliado com ${forecast.description}.`); } catch (error) { return notify(error instanceof Error ? error.message : 'Conciliação não foi concluída.'); }
    setEntries((current) => current.map((entry) => entry.id === actualId || entry.id === forecastId ? { ...entry, status: 'reconciled' } : entry));
    setSelected(null); notify('Conciliação 1:1 confirmada.');
  }

  const chart = useMemo(() => {
    const series = allWeeks.reduce<number[]>((values, week) => [...values, (values.at(-1) ?? 0) + weeklyAmount(filteredEntries, week)], []);
    const max = Math.max(1, ...series.map(Math.abs));
    return series.map((value, index) => `${16 + index * (288 / Math.max(1, series.length - 1))},${92 - (value / max) * 68}`).join(' ');
  }, [allWeeks, filteredEntries]);

  if (runtimeState === 'loading') return <RuntimeGate icon={<LoaderCircle className="spin" />} title="Carregando fluxo de caixa" text="Validando contexto e dados financeiros." />;
  if (runtimeState === 'error') return <RuntimeGate icon={<AlertTriangle />} title="Dataverse indisponível" text={runtimeError} action={() => window.location.reload()} />;

  const navItems = [
    ['flow', Landmark, 'Fluxo'],
    ['imports', FileUp, 'OFX'],
    ['accounts', Building2, 'Contas'],
    ['categories', Tags, 'Categorias'],
    ['counterparties', Users, 'Contrapartes'],
    ['recurrences', Repeat2, 'Recorrências'],
    ['audit', ScrollText, 'Auditoria'],
    ['settings', Settings2, 'Configurações']
  ] as const;
  const overlayOpen = Boolean(selected || modal);

  return <div className="app-shell">
    <aside className="sidebar" aria-label="Navegação principal" aria-hidden={overlayOpen || undefined}>
      <div className="brand"><span className="brand-mark"><WalletCards size={20} /></span><span><strong>Betinhos</strong><small>Financeiro</small></span></div>
      <nav>{navItems.map(([id, Icon, label]) => <button key={id} className={view === id ? 'nav-item active' : 'nav-item'} onClick={() => setView(id)}><Icon size={18} />{label}</button>)}</nav>
      <div className="sidebar-foot"><span className={`runtime-dot ${context.mode}`} />{context.mode === 'xrm' ? 'Dataverse conectado' : context.mode === 'direct' ? 'URL autenticada' : 'Modo demonstração'}<small>v{build.version} {build.builtAt}</small></div>
    </aside>
    <main className="main-content" aria-hidden={overlayOpen || undefined}>
      <header className="topbar"><div><p className="eyebrow">FINANCEIRO / FLUXO SEMANAL</p><h1>{{ flow: 'Fluxo de caixa', imports: 'Importações OFX', accounts: 'Contas bancárias', categories: 'Categorias', counterparties: 'Contrapartes', recurrences: 'Recorrências', audit: 'Auditoria', settings: 'Configurações' }[view]}</h1></div><div className="topbar-actions"><button className="button secondary" onClick={refreshOrders} disabled={loadingSync || mobile}><RefreshCw size={16} className={loadingSync ? 'spin' : ''} />Atualizar OPs</button><button className="button primary" onClick={() => setModal('ofx')} disabled={mobile}><Upload size={16} />Importar OFX</button></div></header>
      {mobile && <div className="mobile-notice"><Menu size={16} />Modo leitura no mobile. Use desktop para importar e editar.</div>}
      {view === 'flow' && <>
        <Filters accounts={accounts} categories={categoryCatalog} account={filterAccount} category={filterCategory} source={filterSource} status={filterStatus} onAccount={setFilterAccount} onCategory={setFilterCategory} onSource={setFilterSource} onStatus={setFilterStatus} />
        <section className="kpis" aria-label="Resumo financeiro">
          <Metric label="Entradas" value={currency.format(inflow)} icon={<ArrowUpRight />} tone="success" hint="semana atual" />
          <Metric label="Saídas" value={currency.format(outflow)} icon={<ArrowDownRight />} tone="danger" hint="previstas e realizadas" />
          <Metric label="Resultado líquido" value={currency.format(result)} icon={<Banknote />} tone={result >= 0 ? 'success' : 'danger'} hint="consolidado" />
          <Metric label="Projeção 26 semanas" value={currency.format(projection)} icon={<Sparkles />} tone="info" hint="sem saldo inicial" />
        </section>
        <section className="content-grid">
          <article className="surface chart-card"><div className="card-heading"><div><p className="eyebrow">VISÃO EXECUTIVA</p><h2>Resultado acumulado</h2></div><span className="badge info">26 semanas</span></div><div className="chart-summary"><strong>{currency.format(projection)}</strong><span><ArrowUpRight size={14} />projeção do período</span></div><svg className="cash-chart" viewBox="0 0 320 112" role="img" aria-label="Gráfico de resultado acumulado"><line x1="16" x2="304" y1="92" y2="92" /><line x1="16" x2="304" y1="56" y2="56" /><line x1="16" x2="304" y1="20" y2="20" /><polyline points={chart} /></svg><div className="chart-legend"><span>Hoje</span><span>{weekLabel(weeks.at(-1) ?? new Date())}</span></div></article>
          <article className="surface attention-card"><div className="card-heading"><div><p className="eyebrow">CONCILIAÇÃO</p><h2>Requer atenção</h2></div><span className="badge warning">{suggestions.length} {suggestions.length === 1 ? 'sugestão' : 'sugestões'}</span></div><div className="attention-list">{suggestions.length ? suggestions.slice(0, 3).map((item) => <button key={item.actual.id} onClick={() => setSelected(item.actual)} disabled={mobile}><span className="icon-wrap"><Clock3 size={16} /></span><span><strong>{item.actual.description}</strong><small>{currency.format(item.actual.amount)} · confiança {item.confidence === 'high' ? 'alta' : 'média'}</small></span><ChevronRight size={16} /></button>) : <Empty text="Sem sugestões pendentes." />}</div></article>
        </section>
        <section className="surface matrix-card"><div className="matrix-toolbar"><div><p className="eyebrow">PLANEJAMENTO</p><h2>{horizon === 'weekly' ? 'Matriz semanal' : 'Visão mensal'}</h2></div><div className="segmented" role="group" aria-label="Horizonte"><button className={horizon === 'weekly' ? 'selected' : ''} onClick={() => setHorizon('weekly')}>26 semanas</button><button className={horizon === 'monthly' ? 'selected' : ''} onClick={() => setHorizon('monthly')}>12 meses</button></div><div className="segmented" role="group" aria-label="Tipo de valor">{(['all', 'forecast', 'actual', 'difference'] as const).map((item) => <button key={item} className={mode === item ? 'selected' : ''} onClick={() => setMode(item)}>{({ all: 'Consolidado', forecast: 'Previsto', actual: 'Realizado', difference: 'Diferença' })[item]}</button>)}</div>{horizon === 'weekly' && <div className="range-actions"><button aria-label="Semanas anteriores" onClick={() => setWeekOffset((value) => Math.max(0, value - 4))}>‹</button><button aria-label="Próximas semanas" onClick={() => setWeekOffset((value) => Math.min(18, value + 4))}>›</button></div>}</div>{horizon === 'weekly' ? <CashMatrix entries={filteredEntries} categories={categories} weeks={weeks} mode={mode} onSelect={setSelected} disabled={mobile} /> : <MonthlyMatrix entries={filteredEntries} categories={categories} months={buildMonths(new Date(), 12)} mode={mode} onSelect={setSelected} disabled={mobile} />}</section>
        <section className="bottom-actions"><button className="button secondary" onClick={() => setModal('manual')} disabled={mobile}><Plus size={16} />Nova previsão</button><button className="button ghost" onClick={() => setView('imports')}><FileUp size={16} />Ver importações</button></section>
      </>}
      {view === 'imports' && <Imports entries={entries} onImport={() => setModal('ofx')} onSelect={setSelected} disabled={mobile} />}
      {view === 'accounts' && <AccountsView items={accounts} readOnly={mobile} onSave={async (item) => { const saved = await persistReference(financeSets.accounts, { cr40f_name: item.name, cr40f_banco: item.bank, cr40f_identificador: item.identifier }, item.id ? item : undefined); if (saved) { setAccounts((all) => [{ ...item, ...saved }, ...all.filter((row) => row.id !== saved.id)]); notify('Conta salva.'); } }} />}
      {view === 'categories' && <CategoriesView items={categoryCatalog} readOnly={mobile} onSave={async (item) => { const saved = await persistReference(financeSets.categories, { cr40f_name: item.name, cr40f_grupo: item.group, cr40f_natureza: item.nature }, item.id ? item : undefined); if (saved) { setCategoryCatalog((all) => [{ ...item, ...saved }, ...all.filter((row) => row.id !== saved.id)]); notify('Categoria salva.'); } }} />}
      {view === 'counterparties' && <CounterpartiesView items={counterparties} readOnly={mobile} onSave={async (item) => { const saved = await persistReference('cr40f_fluxocaixacontrapartes', { cr40f_name: item.name, cr40f_documento: item.document }, item.id ? item : undefined); if (saved) { setCounterparties((all) => [{ ...item, ...saved }, ...all.filter((row) => row.id !== saved.id)]); notify('Contraparte salva.'); } }} />}
      {view === 'recurrences' && <RecurrencesView items={recurrences} categories={categoryCatalog} counterparties={counterparties} readOnly={mobile} onSave={async (item) => {
        const category = categoryCatalog.find((row) => row.id === item.categoryId);
        if (!category) return notify('Selecione uma categoria cadastrada.');
        const body: Record<string, unknown> = { cr40f_name: item.name, cr40f_valor: item.amount, cr40f_categoria: category.name, cr40f_natureza: category.nature, cr40f_frequencia: item.frequency, cr40f_intervalodias: item.intervalDays?.toString(), cr40f_ajustevencimento: item.businessDayPolicy, cr40f_inicio: item.start, cr40f_fim: item.end, 'cr40f_CategoriaRef@odata.bind': `/cr40f_fluxocaixacategorias(${category.id})` };
        if (item.counterpartyId) body['cr40f_ContraparteRef@odata.bind'] = `/cr40f_fluxocaixacontrapartes(${item.counterpartyId})`;
        const saved = await persistReference(financeSets.recurrences, body, item.id ? item : undefined);
        if (saved) {
          setRecurrences((all) => [{ ...item, category: category.name, nature: category.nature, ...saved }, ...all.filter((row) => row.id !== saved.id)]);
          if (context.mode !== 'mock') { await loadRecurringForecasts(context, buildWeeks(new Date(), 26).at(-1) ?? new Date(), holidays.map((holiday) => holiday.date).filter((date): date is string => Boolean(date))); setEntries(await loadEntries(context)); }
          notify('Recorrência salva e previsões futuras atualizadas.');
        }
      }} />}
      {view === 'audit' && <AuditView items={auditEvents} />}
      {view === 'settings' && <SettingsView context={context} settings={settings} holidays={holidays} categories={categoryCatalog} entities={metadataEntities} readOnly={mobile} onSaveSettings={async (item) => {
        const category = categoryCatalog.find((row) => row.id === item.categoryId);
        if (!category) return notify('Selecione a categoria padrão das OPs.');
        const saved = await persistReference(financeSets.settings, { cr40f_name: 'Configuração principal', cr40f_entidadeop: item.entity, cr40f_entitysetop: item.entitySet, cr40f_campoidop: item.idField, cr40f_camponomeop: item.nameField, cr40f_campovalorop: item.amountField, cr40f_campodataop: item.dateField, cr40f_campostatusop: item.statusField, cr40f_valorativoop: item.activeStatusValue, cr40f_categoriaop: category.name, cr40f_campocontraparteop: item.counterpartyField, cr40f_destinatariosalerta: item.recipients, 'cr40f_CategoriaOpRef@odata.bind': `/cr40f_fluxocaixacategorias(${category.id})` }, settings ?? undefined);
        if (saved) { setSettings({ ...saved, ...item, categoryId: category.id, name: 'Configuração principal' }); notify('Configuração de OP validada e salva.'); }
      }} onSaveHoliday={async (item) => { const saved = await persistReference(financeSets.holidays, { cr40f_name: item.name, cr40f_data: item.date }); if (saved) { setHolidays((all) => [{ ...item, ...saved}, ...all]); notify('Feriado salvo.'); } }} />}
      <small className="mobile-version" aria-hidden="true">v{build.version} {build.builtAt}</small>
    </main>
    <nav className="mobile-nav" aria-label="Navegação mobile">{navItems.map(([id, Icon, label]) => <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}><Icon size={17} /><span>{label}</span></button>)}</nav>
    {selected && <EntryDrawer entry={selected} categories={categoryCatalog} suggestion={suggestions.find((item) => item.actual.id === selected.id)} onClose={() => setSelected(null)} onReconcile={reconcile} onUpdateOfx={updateOfx} onReverseBatch={reverseBatch} readOnly={mobile} />}
    {modal === 'manual' && <ManualModal accounts={accounts} categories={categoryCatalog} counterparties={counterparties} onClose={() => setModal(null)} onSubmit={createManual} />}
    {modal === 'ofx' && <OfxModal accounts={accounts} ofx={ofx} accountId={accountId} confirmed={accountMismatchConfirmed} onAccount={(value) => { setAccountId(value); setAccountMismatchConfirmed(matchesOfxAccount(accounts.find((item) => item.id === value), ofx)); }} onConfirmMismatch={setAccountMismatchConfirmed} onClose={() => { setModal(null); setOfx(null); setOfxFile(null); setAccountId(''); setAccountMismatchConfirmed(false); }} onSelect={importFile} onConfirm={confirmOfx} />}
    {notice && <div className="toast" role="status"><CheckCircle2 size={18} />{notice}</div>}
  </div>;
}

function Metric({ label, value, icon, tone, hint }: { label: string; value: string; icon: React.ReactNode; tone: string; hint: string }) { return <article className="metric surface"><span className={`metric-icon ${tone}`}>{icon}</span><p>{label}</p><strong>{value}</strong><small>{hint}</small></article>; }
function Empty({ text }: { text: string }) { return <p className="empty"><CircleAlert size={18} />{text}</p>; }
function RuntimeGate({ icon, title, text, action }: { icon: React.ReactNode; title: string; text: string; action?: () => void }) {
  return <main className="runtime-gate"><article className="surface"><span className="metric-icon info">{icon}</span><p className="eyebrow">FLUXO DE CAIXA</p><h1>{title}</h1><p>{text}</p>{action && <button className="button primary" onClick={action}>Tentar novamente</button>}<small>v{build.version} {build.builtAt}</small></article></main>;
}

function Filters({ accounts, categories, account, category, source, status, onAccount, onCategory, onSource, onStatus }: {
  accounts: FinanceReference[]; categories: FinanceReference[]; account: string; category: string; source: string; status: string;
  onAccount: (value: string) => void; onCategory: (value: string) => void; onSource: (value: string) => void; onStatus: (value: string) => void;
}) {
  return <section className="surface filters" aria-label="Filtros financeiros"><span><Filter size={16} />Filtros</span><select aria-label="Filtrar por conta" value={account} onChange={(event) => onAccount(event.target.value)}><option value="">Todas as contas</option>{accounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select aria-label="Filtrar por categoria" value={category} onChange={(event) => onCategory(event.target.value)}><option value="">Todas as categorias</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select aria-label="Filtrar por origem" value={source} onChange={(event) => onSource(event.target.value)}><option value="">Todas as origens</option><option value="ofx">OFX</option><option value="order">OP</option><option value="manual">Manual</option><option value="recurrence">Recorrência</option></select><select aria-label="Filtrar por status" value={status} onChange={(event) => onStatus(event.target.value)}><option value="">Todos os status</option><option value="open">Aberto</option><option value="reconciled">Conciliado</option><option value="ignored">Ignorado</option><option value="reversed">Revertido</option></select></section>;
}

function CashMatrix({ entries, categories, weeks, mode, onSelect, disabled }: { entries: CashflowEntry[]; categories: string[]; weeks: Date[]; mode: string; onSelect: (entry: CashflowEntry) => void; disabled: boolean }) {
  function cell(category: string, week: Date) {
    const weekEntries = entries.filter((entry) => entry.status !== 'ignored' && entry.status !== 'reversed' && entry.category === category && entry.date >= week.toISOString().slice(0, 10) && entry.date <= new Date(week.getTime() + 6 * 86_400_000).toISOString().slice(0, 10));
    const amount = amountForMode(weekEntries, mode as CashflowMode);
    return <button className={amount < 0 ? 'money negative' : 'money'} onClick={() => weekEntries[0] && onSelect(weekEntries[0])} disabled={disabled}>{amount ? currency.format(amount) : '—'}</button>;
  }
  return <div className="matrix-scroll" tabIndex={0} aria-label="Matriz semanal rolável"><table><thead><tr><th>Categoria</th>{weeks.map((week) => <th key={week.toISOString()}>{weekLabel(week)}</th>)}</tr></thead><tbody>{categories.map((category) => <tr key={category}><th><span>{category}</span><small>{entries.find((entry) => entry.category === category)?.group}</small></th>{weeks.map((week) => <td key={week.toISOString()}>{cell(category, week)}</td>)}</tr>)}</tbody></table></div>;
}

function MonthlyMatrix({ entries, categories, months, mode, onSelect, disabled }: { entries: CashflowEntry[]; categories: string[]; months: Date[]; mode: CashflowMode; onSelect: (entry: CashflowEntry) => void; disabled: boolean }) {
  function cell(category: string, month: Date) {
    const monthEntries = entries.filter((entry) => entry.status !== 'ignored' && entry.status !== 'reversed' && entry.category === category && new Date(`${entry.date}T12:00:00`).getMonth() === month.getMonth() && new Date(`${entry.date}T12:00:00`).getFullYear() === month.getFullYear());
    const amount = amountForMode(monthEntries, mode);
    return <button className={amount < 0 ? 'money negative' : 'money'} onClick={() => monthEntries[0] && onSelect(monthEntries[0])} disabled={disabled}>{amount ? currency.format(amount) : '—'}</button>;
  }
  return <div className="matrix-scroll" tabIndex={0} aria-label="Matriz mensal rolável"><table><thead><tr><th>Categoria</th>{months.map((month) => <th key={month.toISOString()}>{month.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' })}</th>)}</tr></thead><tbody>{categories.map((category) => <tr key={category}><th><span>{category}</span><small>{entries.find((entry) => entry.category === category)?.group}</small></th>{months.map((month) => <td key={month.toISOString()}>{cell(category, month)}</td>)}</tr>)}</tbody></table></div>;
}

function Imports({ entries, onImport, onSelect, disabled }: { entries: CashflowEntry[]; onImport: () => void; onSelect: (entry: CashflowEntry) => void; disabled: boolean }) { const ofx = entries.filter((entry) => entry.source === 'ofx'); return <section className="surface imports"><div className="imports-head"><div><p className="eyebrow">ARQUIVOS BANCÁRIOS</p><h2>Transações OFX</h2><p>Importação atômica. O arquivo original fica guardado no Dataverse.</p></div><button className="button primary" onClick={onImport} disabled={disabled}><Upload size={16} />Importar arquivo</button></div><div className="import-rules"><span><CheckCircle2 />Duplicidade bloqueada</span><span><CheckCircle2 />Conciliação 1:1</span><span><CheckCircle2 />Transferência neutra</span></div><div className="transaction-list">{ofx.map((entry) => <button key={entry.id} className="transaction-row" onClick={() => onSelect(entry)}><span className={`entry-dot ${entry.status}`} /><strong>{entry.description}</strong><span>{formatDate(entry.date)}</span><span>{entry.account}</span><b className={entry.nature === 'outflow' ? 'negative' : ''}>{entry.nature === 'outflow' ? '−' : '+'}{currency.format(entry.amount)}</b><span className="badge neutral">{entry.status === 'reconciled' ? 'Conciliado' : entry.status === 'reversed' ? 'Revertido' : 'Pendente'}</span></button>)}</div></section>; }

function ReferenceForm({ title, children, onSubmit, readOnly }: { title: string; children: React.ReactNode; onSubmit: (form: FormData) => void; readOnly: boolean }) { return <form className="surface reference-form" onSubmit={(event) => { event.preventDefault(); onSubmit(new FormData(event.currentTarget)); event.currentTarget.reset(); }}><div><p className="eyebrow">CADASTRO</p><h2>{title}</h2></div><fieldset disabled={readOnly}><div className="reference-fields">{children}</div></fieldset><button className="button primary" disabled={readOnly}><Save size={16} />Salvar</button></form>; }
function AccountsView({ items, onSave, readOnly }: { items: FinanceReference[]; onSave: (item: FinanceReference) => void; readOnly: boolean }) { return <section className="management-grid"><ReferenceForm title="Nova conta" readOnly={readOnly} onSubmit={(form) => onSave({ id: '', name: String(form.get('name')), bank: String(form.get('bank')), identifier: String(form.get('identifier')) })}><label>Nome<input name="name" required placeholder="Ex.: Itaú matriz" /></label><label>Banco<input name="bank" required placeholder="Ex.: Itaú" /></label><label>Identificador OFX<input name="identifier" required placeholder="Agência/conta" /></label></ReferenceForm><ReferenceList title="Contas ativas" items={items} empty="Nenhuma conta cadastrada." render={(item) => <><strong>{item.name}</strong><small>{item.bank ?? 'Banco não informado'} · {item.identifier ?? 'sem identificador OFX'}</small></>} /></section>; }
function CategoriesView({ items, onSave, readOnly }: { items: FinanceReference[]; onSave: (item: FinanceReference) => void; readOnly: boolean }) { return <section className="management-grid"><ReferenceForm title="Nova categoria" readOnly={readOnly} onSubmit={(form) => onSave({ id: '', name: String(form.get('name')), group: String(form.get('group')), nature: String(form.get('nature')) as FinanceReference['nature'] })}><label>Categoria<input name="name" required placeholder="Ex.: Combustível" /></label><label>Grupo<select name="group" defaultValue="Operacional"><option>Operacional</option><option>Administrativo</option><option>Financeiro</option></select></label><label>Natureza<select name="nature" defaultValue="outflow"><option value="inflow">Entrada</option><option value="outflow">Saída</option><option value="transfer">Transferência interna</option></select></label></ReferenceForm><ReferenceList title="Plano financeiro" items={items} empty="Use o cadastro para formar seu plano de contas." render={(item) => <><strong>{item.name}</strong><small>{item.group ?? 'Sem grupo'} · {item.nature === 'inflow' ? 'Entrada' : item.nature === 'transfer' ? 'Transferência' : 'Saída'}</small></>} /></section>; }
function CounterpartiesView({ items, onSave, readOnly }: { items: FinanceReference[]; onSave: (item: FinanceReference) => void; readOnly: boolean }) { return <section className="management-grid"><ReferenceForm title="Nova contraparte" readOnly={readOnly} onSubmit={(form) => onSave({ id: '', name: String(form.get('name')), document: String(form.get('document')) })}><label>Nome<input name="name" required placeholder="Ex.: Cliente ou fornecedor" /></label><label>Documento<input name="document" placeholder="CPF/CNPJ opcional" /></label></ReferenceForm><ReferenceList title="Contrapartes ativas" items={items} empty="Nenhuma contraparte cadastrada." render={(item) => <><strong>{item.name}</strong><small>{item.document || 'Documento não informado'}</small></>} /></section>; }
function RecurrencesView({ items, categories, counterparties, onSave, readOnly }: { items: FinanceReference[]; categories: FinanceReference[]; counterparties: FinanceReference[]; onSave: (item: FinanceReference) => void; readOnly: boolean }) { return <section className="management-grid"><ReferenceForm title="Nova recorrência" readOnly={readOnly} onSubmit={(form) => onSave({ id: '', name: String(form.get('name')), amount: Number(String(form.get('amount')).replace(',', '.')), categoryId: String(form.get('categoryId')), counterpartyId: String(form.get('counterpartyId')) || undefined, frequency: String(form.get('frequency')) as FinanceReference['frequency'], businessDayPolicy: String(form.get('businessDayPolicy')) as FinanceReference['businessDayPolicy'], intervalDays: Number(form.get('intervalDays')) || undefined, start: String(form.get('start')), end: String(form.get('end')) || undefined })}><label>Descrição<input name="name" required placeholder="Ex.: Aluguel" /></label><label>Valor BRL<input name="amount" required inputMode="decimal" /></label><label>Categoria<select name="categoryId" required defaultValue="" disabled={!categories.length}><option value="" disabled>{categories.length ? 'Selecione uma categoria' : 'Cadastre uma categoria primeiro'}</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label>Contraparte<select name="counterpartyId" defaultValue=""><option value="">Sem contraparte</option>{counterparties.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Frequência<select name="frequency" defaultValue="monthly"><option value="weekly">Semanal</option><option value="monthly">Mensal</option><option value="annual">Anual</option><option value="custom">Customizada</option></select></label><label>Ajuste do vencimento<select name="businessDayPolicy" defaultValue="same"><option value="same">Manter a data</option><option value="previous">Dia útil anterior</option><option value="next">Próximo dia útil</option></select></label><label>Intervalo customizado (dias)<input name="intervalDays" inputMode="numeric" /></label><label>Início<input name="start" required type="date" defaultValue={new Date().toISOString().slice(0, 10)} /></label><label>Fim (opcional)<input name="end" type="date" /></label></ReferenceForm><ReferenceList title="Recorrências ativas" items={items} empty="Nenhuma recorrência cadastrada." render={(item) => <><strong>{item.name} · {currency.format(item.amount ?? 0)}</strong><small>{({ weekly: 'Semanal', monthly: 'Mensal', annual: 'Anual', custom: `A cada ${item.intervalDays} dias` })[item.frequency ?? 'monthly']} · a partir de {item.start ? formatDate(item.start) : '—'}</small></>} /><p className="form-note">Somente ocorrências futuras abertas são recalculadas. Conciliações permanecem preservadas.</p></section>; }
function ReferenceList({ title, items, empty, render }: { title: string; items: FinanceReference[]; empty: string; render: (item: FinanceReference) => React.ReactNode }) { return <article className="surface reference-list"><div><p className="eyebrow">GESTÃO</p><h2>{title}</h2></div>{items.length ? <div>{items.map((item) => <div className="reference-row" key={item.id}>{render(item)}</div>)}</div> : <Empty text={empty} />}</article>; }
function AuditView({ items }: { items: FinanceReference[] }) { return <section className="audit-view surface"><div><p className="eyebrow">RASTREABILIDADE</p><h2>Eventos financeiros</h2><p>Importações, ajustes OFX, conciliações e reversões são registrados no Dataverse.</p></div>{items.length ? <div className="audit-list">{items.map((item) => <article key={item.id}><span className="icon-wrap"><ScrollText size={16} /></span><div><strong>{item.action ?? item.name}</strong><p>{item.detail ?? 'Evento financeiro registrado.'}</p></div><time>{item.date ? formatDate(item.date) : '—'}</time></article>)}</div> : <Empty text="Nenhum evento auditado neste contexto." />}</section>; }
function SettingsView({ context, settings, holidays, categories, entities, readOnly, onSaveSettings, onSaveHoliday }: {
  context: RuntimeContext; settings: FinanceReference | null; holidays: FinanceReference[]; categories: FinanceReference[]; entities: MetadataEntity[]; readOnly: boolean;
  onSaveSettings: (item: { entity: string; entitySet: string; idField: string; nameField: string; amountField: string; dateField: string; statusField: string; activeStatusValue: string; categoryId: string; counterpartyField: string; recipients: string }) => void;
  onSaveHoliday: (item: FinanceReference) => void;
}) {
  const [entityName, setEntityName] = useState(String(settings?.entity ?? ''));
  const [statusField, setStatusField] = useState(String(settings?.statusField ?? ''));
  const [activeStatusValue, setActiveStatusValue] = useState(String(settings?.activeStatusValue ?? ''));
  const [metadata, setMetadata] = useState<MetadataEntity | null>(null);
  const [metadataError, setMetadataError] = useState('');
  useEffect(() => {
    if (!entityName || context.mode === 'mock') { setMetadata(null); return; }
    setMetadataError('');
    void loadEntityMetadata(context, entityName).then(setMetadata).catch((error) => { setMetadata(null); setMetadataError(error instanceof Error ? error.message : 'Metadata indisponível.'); });
  }, [context, entityName]);
  const fields = metadata?.attributes ?? [];
  const idFields = fields.filter((field) => field.attributeType === 'Uniqueidentifier');
  const nameFields = fields.filter((field) => ['String', 'Memo'].includes(field.attributeType));
  const amountFields = fields.filter((field) => ['Money', 'Decimal', 'Double', 'Integer', 'BigInt'].includes(field.attributeType));
  const dateFields = fields.filter((field) => field.attributeType === 'DateTime');
  const statusFields = fields.filter((field) => ['Picklist', 'State', 'Status'].includes(field.attributeType) && field.options?.length);
  const selectedStatus = statusFields.find((field) => field.logicalName === statusField) ?? statusFields[0];
  useEffect(() => {
    const options = selectedStatus?.options ?? [];
    if (!options.some((option) => option.value === activeStatusValue)) setActiveStatusValue(options[0]?.value ?? '');
  }, [activeStatusValue, selectedStatus]);
  return <section className="settings-page"><ReferenceForm title="Integração e alertas" readOnly={readOnly} onSubmit={(form) => onSaveSettings({ entity: String(form.get('entity')), entitySet: metadata?.entitySetName ?? '', idField: String(form.get('idField')), nameField: String(form.get('nameField')), amountField: String(form.get('amountField')), dateField: String(form.get('dateField')), statusField: String(form.get('statusField')), activeStatusValue: String(form.get('activeStatusValue')), categoryId: String(form.get('categoryId')), counterpartyField: String(form.get('counterpartyField')), recipients: String(form.get('recipients')) })}><label>Entidade da OP<select name="entity" required value={entityName} onChange={(event) => { setEntityName(event.target.value); setStatusField(''); setActiveStatusValue(''); }}><option value="" disabled>Selecione pela metadata</option>{entities.map((entity) => <option key={entity.logicalName} value={entity.logicalName}>{entity.displayName} · {entity.logicalName}</option>)}</select></label><label>Entity set<input readOnly value={metadata?.entitySetName ?? ''} aria-label="Entity set derivado" /></label><MetadataSelect key={`${entityName}:id`} label="Campo ID" name="idField" fields={idFields} value={String(settings?.entity === entityName ? settings.idField ?? '' : '')} /><MetadataSelect key={`${entityName}:name`} label="Campo descrição" name="nameField" fields={nameFields} value={String(settings?.entity === entityName ? settings.nameField ?? '' : '')} /><MetadataSelect key={`${entityName}:amount`} label="Campo valor" name="amountField" fields={amountFields} value={String(settings?.entity === entityName ? settings.amountField ?? '' : '')} /><MetadataSelect key={`${entityName}:date`} label="Campo vencimento" name="dateField" fields={dateFields} value={String(settings?.entity === entityName ? settings.dateField ?? '' : '')} /><label>Campo status<select name="statusField" required value={statusField} onChange={(event) => { setStatusField(event.target.value); setActiveStatusValue(''); }}><option value="" disabled>Selecione pela metadata</option>{statusFields.map((field) => <option key={field.logicalName} value={field.logicalName}>{field.displayName} · {field.logicalName}</option>)}</select></label><label>Valor considerado ativo<select name="activeStatusValue" required value={activeStatusValue} onChange={(event) => setActiveStatusValue(event.target.value)}><option value="" disabled>Selecione pela metadata</option>{(selectedStatus?.options ?? []).map((option) => <option key={option.value} value={option.value}>{option.label} · {option.value}</option>)}</select></label><label>Categoria padrão<select name="categoryId" required defaultValue={String(settings?.categoryId ?? '')}><option value="" disabled>Selecione uma categoria</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><MetadataSelect key={`${entityName}:counterparty`} label="Campo contraparte (opcional)" name="counterpartyField" fields={nameFields} value={String(settings?.entity === entityName ? settings.counterpartyField ?? '' : '')} optional /><label>Destinatários dos alertas<input name="recipients" defaultValue={String(settings?.recipients ?? '')} placeholder="financeiro@empresa.com; diretoria@empresa.com" /></label>{metadataError && <p className="form-error">{metadataError}</p>}</ReferenceForm><div className="settings-side"><ReferenceForm title="Feriado financeiro" readOnly={readOnly} onSubmit={(form) => onSaveHoliday({ id: '', name: String(form.get('name')), date: String(form.get('date')) })}><label>Nome<input name="name" required /></label><label>Data<input name="date" required type="date" /></label></ReferenceForm><ReferenceList title="Calendário" items={holidays} empty="Sem feriados cadastrados." render={(item) => <><strong>{item.name}</strong><small>{item.date ? formatDate(item.date) : '—'}</small></>} /><article className="surface setting"><SlidersHorizontal /><div><p className="eyebrow">AMBIENTE</p><h2>Runtime atual</h2><p>{context.mode === 'xrm' ? 'Model-driven conectado por parent.Xrm.' : context.mode === 'direct' ? 'URL direta autenticada por WhoAmI.' : 'Mock local, sem envio ao Dataverse.'}</p><span className="badge neutral">{context.mode}</span></div></article></div></section>;
}

function MetadataSelect({ label, name, fields, value, optional = false }: { label: string; name: string; fields: MetadataEntity['attributes']; value: string; optional?: boolean }) {
  return <label>{label}<select name={name} required={!optional} defaultValue={value}><option value="">{optional ? 'Sem mapeamento' : 'Selecione pela metadata'}</option>{fields.map((field) => <option key={field.logicalName} value={field.logicalName}>{field.displayName} · {field.logicalName}</option>)}</select></label>;
}

function useDialogFocus<T extends HTMLElement>(onClose: () => void) {
  const ref = useRef<T>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const focusable = () => [...(node?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])') ?? [])];
    focusable()[0]?.focus();
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); onCloseRef.current(); return; }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0]; const last = items.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    node?.addEventListener('keydown', keydown);
    return () => { node?.removeEventListener('keydown', keydown); previous?.focus(); };
  }, []);
  return ref;
}

function EntryDrawer({ entry, categories, suggestion, onClose, onReconcile, onUpdateOfx, onReverseBatch, readOnly }: { entry: CashflowEntry; categories: FinanceReference[]; suggestion?: { forecast: CashflowEntry }; onClose: () => void; onReconcile: (actualId: string, forecastId: string) => void; onUpdateOfx: (entry: CashflowEntry, description: string, date: string, categoryId: string, transfer: boolean) => void; onReverseBatch: (entry: CashflowEntry) => void; readOnly: boolean }) {
  const [editing, setEditing] = useState(false);
  const ref = useDialogFocus<HTMLElement>(onClose);
  return <><button className="drawer-backdrop" aria-label="Fechar detalhe" tabIndex={-1} onClick={onClose} /><aside ref={ref} className="drawer" role="dialog" aria-modal="true" aria-labelledby="entry-drawer-title"><header><div><p className="eyebrow">LANÇAMENTO</p><h2 id="entry-drawer-title">Detalhe financeiro</h2></div><button className="icon-button" onClick={onClose} aria-label="Fechar"><X size={18} /></button></header><div className="drawer-content"><span className={`status-line ${entry.status}`}>{entry.status === 'reconciled' ? <CheckCircle2 /> : <Clock3 />}{entry.status === 'reconciled' ? 'Conciliado' : entry.status === 'reversed' ? 'Lote revertido' : 'Pendente de conciliação'}</span><h3>{entry.description}</h3><strong className={entry.nature === 'outflow' ? 'amount negative' : 'amount'}>{entry.nature === 'outflow' ? '−' : '+'}{currency.format(entry.amount)}</strong><dl><div><dt>Data</dt><dd>{formatDate(entry.date)}</dd></div><div><dt>Categoria</dt><dd>{entry.category}</dd></div><div><dt>Origem</dt><dd>{entry.source === 'ofx' ? 'Importação OFX' : entry.source === 'order' ? 'OP ativa' : entry.source === 'recurrence' ? 'Recorrência' : 'Previsão manual'}</dd></div><div><dt>Conta</dt><dd>{entry.account ?? '—'}</dd></div></dl>{entry.source === 'ofx' && <><div className="original-box"><small>Original OFX — valor imutável</small><p>{entry.originalDescription ?? entry.description}<br />{entry.originalDate ? formatDate(entry.originalDate) : formatDate(entry.date)}</p></div>{editing ? <form className="drawer-edit" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); onUpdateOfx(entry, String(form.get('description')), String(form.get('date')), String(form.get('categoryId')), form.get('transfer') === 'on'); setEditing(false); }}><label>Descrição<input name="description" defaultValue={entry.description} required /></label><label>Data<input name="date" type="date" defaultValue={entry.date} required /></label><label>Categoria<select name="categoryId" defaultValue={entry.categoryId ?? ''} required disabled={!categories.length}>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="check-label"><input name="transfer" type="checkbox" defaultChecked={entry.nature === 'transfer'} />Transferência interna neutra</label><button className="button secondary" disabled={readOnly || !categories.length}>Salvar ajustes</button></form> : <div className="drawer-actions"><button className="button secondary" onClick={() => setEditing(true)} disabled={readOnly}>Editar OFX</button>{entry.importId && <button className="button ghost danger-action" onClick={() => onReverseBatch(entry)} disabled={readOnly}><Undo2 size={16} />Reverter lote</button>}</div>}</>}</div>{suggestion && <footer><p><Sparkles size={16} />Previsão compatível encontrada: {suggestion.forecast.description}</p><button className="button primary" onClick={() => onReconcile(entry.id, suggestion.forecast.id)} disabled={readOnly}>Confirmar conciliação 1:1</button></footer>}</aside></>;
}

function ManualModal({ accounts, categories, counterparties, onClose, onSubmit }: { accounts: FinanceReference[]; categories: FinanceReference[]; counterparties: FinanceReference[]; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const hasReferences = accounts.length > 0 && categories.length > 0;
  const ref = useDialogFocus<HTMLFormElement>(onClose);
  return <div className="modal-layer"><button className="drawer-backdrop" aria-label="Fechar" tabIndex={-1} onClick={onClose} /><form ref={ref} className="modal" role="dialog" aria-modal="true" aria-labelledby="manual-title" onSubmit={onSubmit}><header><div><p className="eyebrow">PREVISÃO</p><h2 id="manual-title">Novo lançamento manual</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="Fechar"><X size={18} /></button></header><label>Descrição<input name="description" required placeholder="Ex.: Manutenção programada" /></label><div className="form-row"><label>Valor (BRL)<input name="amount" required inputMode="decimal" placeholder="0,00" /></label><label>Data<input name="date" required type="date" defaultValue={new Date().toISOString().slice(0, 10)} /></label></div><div className="form-row"><label>Conta bancária<select name="accountId" required defaultValue="" disabled={!accounts.length}><option value="" disabled>{accounts.length ? 'Selecione uma conta' : 'Cadastre uma conta primeiro'}</option>{accounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Categoria<select name="categoryId" required defaultValue="" disabled={!categories.length}><option value="" disabled>{categories.length ? 'Selecione uma categoria' : 'Cadastre uma categoria primeiro'}</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div><label>Contraparte<select name="counterpartyId" defaultValue=""><option value="">Sem contraparte</option>{counterparties.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><p className="form-note">Conta, categoria e contraparte vêm dos cadastros mestres. Este formulário cria somente previsão.</p><footer><button className="button secondary" type="button" onClick={onClose}>Cancelar</button><button className="button primary" type="submit" disabled={!hasReferences}>Criar previsão</button></footer></form></div>;
}

function OfxModal({ accounts, ofx, accountId, confirmed, onAccount, onConfirmMismatch, onClose, onSelect, onConfirm }: { accounts: FinanceReference[]; ofx: OfxImportResult | null; accountId: string; confirmed: boolean; onAccount: (value: string) => void; onConfirmMismatch: (value: boolean) => void; onClose: () => void; onSelect: (event: ChangeEvent<HTMLInputElement>) => void; onConfirm: () => void }) {
  const ref = useDialogFocus<HTMLDivElement>(onClose);
  const selected = accounts.find((item) => item.id === accountId);
  const mismatch = Boolean(ofx && selected && !matchesOfxAccount(selected, ofx));
  return <div className="modal-layer"><button className="drawer-backdrop" aria-label="Fechar" tabIndex={-1} onClick={onClose} /><div ref={ref} className="modal ofx-modal" role="dialog" aria-modal="true" aria-labelledby="ofx-title"><header><div><p className="eyebrow">BANCO</p><h2 id="ofx-title">Importar OFX</h2></div><button className="icon-button" onClick={onClose} aria-label="Fechar"><X size={18} /></button></header>{!ofx ? <label className="dropzone"><FileUp size={28} /><strong>Selecione um arquivo OFX</strong><span>Um arquivo por vez. A importação será atômica.</span><input type="file" accept=".ofx,.qfx,text/ofx" onChange={onSelect} /></label> : <><div className="import-summary"><Landmark /><div><strong>{ofx.transactions.length} transações encontradas</strong><small>Banco/conta OFX {ofx.bankId ?? '—'} / {ofx.accountId ?? 'não identificada'} · BRL</small></div></div><label>Conta bancária cadastrada<select value={accountId} onChange={(event) => onAccount(event.target.value)} required><option value="" disabled>{accounts.length ? 'Selecione uma conta' : 'Cadastre a conta antes de importar'}</option>{accounts.map((item) => <option key={item.id} value={item.id}>{item.name}{item.identifier ? ` · ${item.bank ?? 'banco não informado'} / ${item.identifier}` : ''}</option>)}</select></label>{mismatch && <label className="check-label warning-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => onConfirmMismatch(event.target.checked)} />Confirmo que a conta selecionada corresponde ao BANKID/ACCTID {ofx.bankId ?? '—'} / {ofx.accountId}</label>}<p className="form-note">A conta é sempre selecionada do cadastro mestre. BANKID/ACCTID divergentes exigem confirmação explícita.</p><footer><button className="button secondary" onClick={onClose}>Cancelar</button><button className="button primary" onClick={onConfirm} disabled={!accountId || (mismatch && !confirmed)}>Importar {ofx.transactions.length} transações</button></footer></>}</div></div>;
}

createRoot(document.getElementById('root')!).render(<App />);

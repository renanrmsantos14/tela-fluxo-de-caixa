import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowDownRight, ArrowUpRight, Banknote, CalendarDays, CheckCircle2, ChevronRight, CircleAlert, Clock3, FileUp, Landmark, Menu, Plus, RefreshCw, Settings2, Sparkles, Upload, WalletCards, X } from 'lucide-react';
import './styles.css';
import { included, total, buildWeeks, currency, signedAmount, suggestReconciliations, weeklyAmount } from './lib/cashflow';
import { addDays, dateOnly, formatDate, weekLabel } from './lib/date';
import { parseOfx } from './lib/ofx';
import { resolveRuntimeContext } from './lib/runtime';
import { importOfxAtomically, loadEntries, loadOrderMapping, loadRecurringForecasts, saveEntry, syncActiveOrders, updateReconciliation } from './lib/dataverse';
import { mockEntries } from './data/mock';
import type { CashflowEntry, OfxImportResult, RuntimeContext } from './types';

type View = 'flow' | 'imports' | 'settings';
type Modal = 'manual' | 'ofx' | null;
const build = window.__APP_BUILD_INFO;

function App() {
  const [view, setView] = useState<View>('flow');
  const [entries, setEntries] = useState<CashflowEntry[]>(mockEntries);
  const [context, setContext] = useState<RuntimeContext>({ mode: 'mock' });
  const [selected, setSelected] = useState<CashflowEntry | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [ofx, setOfx] = useState<OfxImportResult | null>(null);
  const [ofxFile, setOfxFile] = useState<File | null>(null);
  const [account, setAccount] = useState('Itaú · 4521');
  const [notice, setNotice] = useState<string | null>(null);
  const [loadingSync, setLoadingSync] = useState(false);
  const [mode, setMode] = useState<'all' | 'forecast' | 'actual' | 'difference'>('all');
  const [weekOffset, setWeekOffset] = useState(0);
  const [mobile, setMobile] = useState(() => window.innerWidth < 820);

  useEffect(() => {
    async function hydrate() {
      const resolved = await resolveRuntimeContext();
      setContext(resolved);
      if (resolved.mode === 'mock') return;
      try {
        const [, mapping, recurring] = await Promise.all([loadEntries(resolved), loadOrderMapping(resolved), loadRecurringForecasts(resolved, buildWeeks(new Date(), 26).at(-1) ?? new Date())]);
        const orders = await syncActiveOrders(resolved, mapping);
        const latest = await loadEntries(resolved);
        setEntries([...latest, ...recurring, ...orders.filter((entry) => !latest.some((stored) => stored.id === entry.id))]);
      } catch (error) { notify(error instanceof Error ? `Dados locais exibidos: ${error.message}` : 'Dados locais exibidos.'); }
    }
    void hydrate();
    const listener = () => setMobile(window.innerWidth < 820);
    window.addEventListener('resize', listener);
    return () => window.removeEventListener('resize', listener);
  }, []);

  const allWeeks = useMemo(() => buildWeeks(new Date(), 26), []);
  const weeks = useMemo(() => allWeeks.slice(weekOffset, weekOffset + 8), [allWeeks, weekOffset]);
  const categories = useMemo(() => [...new Set(entries.filter((entry) => entry.nature !== 'transfer').map((entry) => entry.category))], [entries]);
  const currentWeek = weeks[0];
  const currentWeekEnd = dateOnly(addDays(currentWeek, 6));
  const inflow = total(entries, (entry) => entry.nature === 'inflow' && entry.date >= dateOnly(currentWeek) && entry.date <= currentWeekEnd);
  const outflow = Math.abs(total(entries, (entry) => entry.nature === 'outflow' && entry.date >= dateOnly(currentWeek) && entry.date <= currentWeekEnd));
  const result = total(entries, () => true);
  const projection = allWeeks.reduce((sum, week) => sum + weeklyAmount(entries, week), 0);
  const suggestions = useMemo(() => suggestReconciliations(entries), [entries]);

  function notify(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 3500);
  }

  async function refreshOrders() {
    setLoadingSync(true);
    try {
      const orders = await syncActiveOrders(context, await loadOrderMapping(context));
      if (orders.length && context.mode !== 'mock') { const latest = await loadEntries(context); setEntries((current) => [...latest, ...current.filter((entry) => entry.source === 'recurrence')]); }
      else if (orders.length) setEntries((current) => [...current.filter((entry) => entry.source !== 'order'), ...orders]);
      notify(orders.length ? `${orders.length} OPs atualizadas.` : 'Sincronização concluída. Configure o mapeamento de OP para importar previsões.');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Não foi possível sincronizar as OPs.');
    } finally {
      setLoadingSync(false);
    }
  }

  function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    file.text().then(parseOfx).then((result) => {
      if (result.currency !== 'BRL') throw new Error('Este V0 aceita apenas OFX em BRL.');
      setOfx(result); setOfxFile(file);
      setAccount(result.accountId ? `Conta OFX · ${result.accountId}` : 'Itaú · 4521');
    }).catch((error) => notify(error instanceof Error ? error.message : 'Arquivo OFX inválido.'));
    event.target.value = '';
  }

  async function confirmOfx() {
    if (!ofx || !ofxFile) return;
    const imported = ofx.transactions.map((transaction, index): CashflowEntry => ({
      id: `ofx-${ofx.fingerprint.slice(0, 8)}-${index}`,
      description: transaction.description,
      originalDescription: transaction.description,
      date: transaction.date,
      originalDate: transaction.date,
      amount: Math.abs(transaction.amount),
      category: 'A classificar',
      group: 'A classificar',
      kind: 'actual',
      nature: transaction.amount >= 0 ? 'inflow' : 'outflow',
      status: 'open',
      source: 'ofx',
      account,
      fitId: transaction.fitId,
      transactionKey: `${ofx.bankId ?? 'bank'}|${ofx.accountId ?? account}|${transaction.date}|${transaction.amount.toFixed(2)}|${transaction.description.trim().toLocaleLowerCase('pt-BR')}`
    }));
    const fitIds = imported.map((entry) => entry.fitId).filter((value): value is string => Boolean(value));
    const keys = imported.map((entry) => entry.transactionKey!);
    const duplicate = new Set(fitIds).size !== fitIds.length || new Set(keys).size !== keys.length || entries.some((entry) => (entry.fitId && fitIds.includes(entry.fitId)) || (entry.transactionKey && keys.includes(entry.transactionKey)));
    if (duplicate) return notify('Importação bloqueada: transação OFX já existe.');
    try { await importOfxAtomically(context, ofx, account, ofxFile, imported); } catch (error) { return notify(error instanceof Error ? error.message : 'Importação OFX não foi concluída.'); }
    if (context.mode === 'mock') setEntries((current) => [...imported, ...current]);
    else { const latest = await loadEntries(context); setEntries((current) => [...latest, ...current.filter((entry) => entry.source === 'recurrence')]); }
    setOfx(null); setOfxFile(null); setModal(null);
    notify(`${imported.length} transações importadas. Pendentes ficam fora do cálculo até conciliação.`);
  }

  async function createManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = Number(String(form.get('amount')).replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) return notify('Informe valor válido.');
    const entry: CashflowEntry = {
      id: crypto.randomUUID(), description: String(form.get('description')), category: String(form.get('category')),
      group: 'Manual', amount: value, date: String(form.get('date')), kind: 'forecast',
      nature: String(form.get('nature')) as CashflowEntry['nature'], status: 'open', source: 'manual'
    };
    try { await saveEntry(context, entry); } catch { notify('Previsão salva localmente; persistência Dataverse indisponível neste contexto.'); }
    setEntries((current) => [entry, ...current]); setModal(null); notify('Previsão manual criada.');
  }

  async function reconcile(actualId: string, forecastId: string) {
    if (mobile) return;
    const actual = entries.find((entry) => entry.id === actualId);
    const forecast = entries.find((entry) => entry.id === forecastId);
    if (!actual || !forecast || actual.kind !== 'actual' || forecast.kind !== 'forecast' || actual.status !== 'open' || forecast.status !== 'open') return notify('Conciliação indisponível para estes lançamentos.');
    try { await updateReconciliation(context, actual, forecast); } catch (error) { return notify(error instanceof Error ? error.message : 'Conciliação não foi concluída.'); }
    setEntries((current) => current.map((entry) => entry.id === actualId || entry.id === forecastId ? { ...entry, status: 'reconciled' } : entry));
    setSelected(null); notify('Conciliação 1:1 confirmada.');
  }

  const chart = useMemo(() => {
    const series = allWeeks.reduce<number[]>((values, week) => [...values, (values.at(-1) ?? 0) + weeklyAmount(entries, week)], []);
    const max = Math.max(1, ...series.map(Math.abs));
    return series.map((value, index) => `${16 + index * (288 / Math.max(1, series.length - 1))},${92 - (value / max) * 68}`).join(' ');
  }, [allWeeks, entries]);

  return <div className="app-shell">
    <aside className="sidebar" aria-label="Navegação principal">
      <div className="brand"><span className="brand-mark"><WalletCards size={20} /></span><span><strong>Betinhos</strong><small>Financeiro</small></span></div>
      <nav>{([
        ['flow', Landmark, 'Fluxo de caixa'], ['imports', FileUp, 'Importações OFX'], ['settings', Settings2, 'Configurações']
      ] as const).map(([id, Icon, label]) => <button key={id} className={view === id ? 'nav-item active' : 'nav-item'} onClick={() => setView(id)}><Icon size={18} />{label}</button>)}</nav>
      <div className="sidebar-foot"><span className={`runtime-dot ${context.mode}`} />{context.mode === 'xrm' ? 'Dataverse conectado' : context.mode === 'direct' ? 'URL autenticada' : 'Modo demonstração'}<small>v{build?.version ?? '0.1.0'}</small></div>
    </aside>
    <main className="main-content">
      <header className="topbar"><div><p className="eyebrow">FINANCEIRO / FLUXO SEMANAL</p><h1>{view === 'flow' ? 'Fluxo de caixa' : view === 'imports' ? 'Importações OFX' : 'Configurações'}</h1></div><div className="topbar-actions"><button className="button secondary" onClick={refreshOrders} disabled={loadingSync || mobile}><RefreshCw size={16} className={loadingSync ? 'spin' : ''} />Atualizar OPs</button><button className="button primary" onClick={() => setModal('ofx')} disabled={mobile}><Upload size={16} />Importar OFX</button></div></header>
      {mobile && <div className="mobile-notice"><Menu size={16} />Modo leitura no mobile. Use desktop para importar e editar.</div>}
      {view === 'flow' && <>
        <section className="kpis" aria-label="Resumo financeiro">
          <Metric label="Entradas" value={currency.format(inflow)} icon={<ArrowUpRight />} tone="success" hint="semana atual" />
          <Metric label="Saídas" value={currency.format(outflow)} icon={<ArrowDownRight />} tone="danger" hint="previstas e realizadas" />
          <Metric label="Resultado líquido" value={currency.format(result)} icon={<Banknote />} tone={result >= 0 ? 'success' : 'danger'} hint="consolidado" />
          <Metric label="Projeção 26 semanas" value={currency.format(projection)} icon={<Sparkles />} tone="info" hint="sem saldo inicial" />
        </section>
        <section className="content-grid">
          <article className="surface chart-card"><div className="card-heading"><div><p className="eyebrow">VISÃO EXECUTIVA</p><h2>Resultado acumulado</h2></div><span className="badge info">26 semanas</span></div><div className="chart-summary"><strong>{currency.format(projection)}</strong><span><ArrowUpRight size={14} />projeção do período</span></div><svg className="cash-chart" viewBox="0 0 320 112" role="img" aria-label="Gráfico de resultado acumulado"><line x1="16" x2="304" y1="92" y2="92" /><line x1="16" x2="304" y1="56" y2="56" /><line x1="16" x2="304" y1="20" y2="20" /><polyline points={chart} /></svg><div className="chart-legend"><span>Hoje</span><span>{weekLabel(weeks.at(-1) ?? new Date())}</span></div></article>
          <article className="surface attention-card"><div className="card-heading"><div><p className="eyebrow">CONCILIAÇÃO</p><h2>Requer atenção</h2></div><span className="badge warning">{suggestions.length} sugestão{suggestions.length === 1 ? '' : 'ões'}</span></div><div className="attention-list">{suggestions.length ? suggestions.slice(0, 3).map((item) => <button key={item.actual.id} onClick={() => setSelected(item.actual)} disabled={mobile}><span className="icon-wrap"><Clock3 size={16} /></span><span><strong>{item.actual.description}</strong><small>{currency.format(item.actual.amount)} · confiança {item.confidence === 'high' ? 'alta' : 'média'}</small></span><ChevronRight size={16} /></button>) : <Empty text="Sem sugestões pendentes." />}</div></article>
        </section>
        <section className="surface matrix-card"><div className="matrix-toolbar"><div><p className="eyebrow">PLANEJAMENTO</p><h2>Matriz semanal</h2></div><div className="segmented" role="group" aria-label="Tipo de valor">{(['all', 'forecast', 'actual', 'difference'] as const).map((item) => <button key={item} className={mode === item ? 'selected' : ''} onClick={() => setMode(item)}>{({ all: 'Consolidado', forecast: 'Previsto', actual: 'Realizado', difference: 'Diferença' })[item]}</button>)}</div><div className="range-actions"><button aria-label="Semanas anteriores" onClick={() => setWeekOffset((value) => Math.max(0, value - 4))}>‹</button><button aria-label="Próximas semanas" onClick={() => setWeekOffset((value) => Math.min(18, value + 4))}>›</button></div></div><CashMatrix entries={entries} categories={categories} weeks={weeks} mode={mode} onSelect={setSelected} disabled={mobile} /></section>
        <section className="bottom-actions"><button className="button secondary" onClick={() => setModal('manual')} disabled={mobile}><Plus size={16} />Nova previsão</button><button className="button ghost" onClick={() => setView('imports')}><FileUp size={16} />Ver importações</button></section>
      </>}
      {view === 'imports' && <Imports entries={entries} onImport={() => setModal('ofx')} disabled={mobile} />}
      {view === 'settings' && <SettingsView context={context} />}
    </main>
    {selected && <EntryDrawer entry={selected} suggestion={suggestions.find((item) => item.actual.id === selected.id)} onClose={() => setSelected(null)} onReconcile={reconcile} readOnly={mobile} />}
    {modal === 'manual' && <ManualModal onClose={() => setModal(null)} onSubmit={createManual} />}
    {modal === 'ofx' && <OfxModal ofx={ofx} account={account} onAccount={setAccount} onClose={() => { setModal(null); setOfx(null); setOfxFile(null); }} onSelect={importFile} onConfirm={confirmOfx} />}
    {notice && <div className="toast" role="status"><CheckCircle2 size={18} />{notice}</div>}
  </div>;
}

function Metric({ label, value, icon, tone, hint }: { label: string; value: string; icon: React.ReactNode; tone: string; hint: string }) { return <article className="metric surface"><span className={`metric-icon ${tone}`}>{icon}</span><p>{label}</p><strong>{value}</strong><small>{hint}</small></article>; }
function Empty({ text }: { text: string }) { return <p className="empty"><CircleAlert size={18} />{text}</p>; }

function CashMatrix({ entries, categories, weeks, mode, onSelect, disabled }: { entries: CashflowEntry[]; categories: string[]; weeks: Date[]; mode: string; onSelect: (entry: CashflowEntry) => void; disabled: boolean }) {
  function cell(category: string, week: Date) {
    const weekEntries = entries.filter((entry) => included(entry) && entry.category === category && entry.date >= week.toISOString().slice(0, 10) && entry.date <= new Date(week.getTime() + 6 * 86_400_000).toISOString().slice(0, 10));
    const forecast = weekEntries.filter((entry) => entry.kind === 'forecast').reduce((sum, entry) => sum + signedAmount(entry), 0);
    const actual = weekEntries.filter((entry) => entry.kind === 'actual' && entry.status === 'reconciled').reduce((sum, entry) => sum + signedAmount(entry), 0);
    const amount = mode === 'forecast' ? forecast : mode === 'actual' ? actual : mode === 'difference' ? actual - forecast : forecast + actual;
    return <button className={amount < 0 ? 'money negative' : 'money'} onClick={() => weekEntries[0] && onSelect(weekEntries[0])} disabled={disabled}>{amount ? currency.format(amount) : '—'}</button>;
  }
  return <div className="matrix-scroll"><table><thead><tr><th>Categoria</th>{weeks.map((week) => <th key={week.toISOString()}>{weekLabel(week)}</th>)}</tr></thead><tbody>{categories.map((category) => <tr key={category}><th><span>{category}</span><small>{entries.find((entry) => entry.category === category)?.group}</small></th>{weeks.map((week) => <td key={week.toISOString()}>{cell(category, week)}</td>)}</tr>)}</tbody></table></div>;
}

function Imports({ entries, onImport, disabled }: { entries: CashflowEntry[]; onImport: () => void; disabled: boolean }) { const ofx = entries.filter((entry) => entry.source === 'ofx'); return <section className="surface imports"><div className="imports-head"><div><p className="eyebrow">ARQUIVOS BANCÁRIOS</p><h2>Transações OFX</h2><p>Importação atômica. O arquivo original fica guardado no Dataverse.</p></div><button className="button primary" onClick={onImport} disabled={disabled}><Upload size={16} />Importar arquivo</button></div><div className="import-rules"><span><CheckCircle2 />Duplicidade bloqueada</span><span><CheckCircle2 />Conciliação 1:1</span><span><CheckCircle2 />Transferência neutra</span></div><div className="transaction-list">{ofx.map((entry) => <div key={entry.id}><span className={`entry-dot ${entry.status}`} /><strong>{entry.description}</strong><span>{formatDate(entry.date)}</span><span>{entry.account}</span><b className={entry.nature === 'outflow' ? 'negative' : ''}>{entry.nature === 'outflow' ? '−' : '+'}{currency.format(entry.amount)}</b><span className="badge neutral">{entry.status === 'reconciled' ? 'Conciliado' : 'Pendente'}</span></div>)}</div></section>; }

function SettingsView({ context }: { context: RuntimeContext }) { return <section className="settings-grid"><article className="surface setting"><Landmark /><div><p className="eyebrow">INTEGRAÇÃO</p><h2>Mapeamento de OPs</h2><p>Defina entidade, valor a receber, data de emissão e regra de vencimento. O sistema consulta metadata antes de sincronizar.</p><span className="badge warning">Configuração necessária</span></div></article><article className="surface setting"><CalendarDays /><div><p className="eyebrow">CALENDÁRIO</p><h2>Regras financeiras</h2><p>Semana segunda–domingo, horizonte de 26 semanas e feriados configuráveis.</p><span className="badge info">BRL · semanal</span></div></article><article className="surface setting"><Settings2 /><div><p className="eyebrow">AMBIENTE</p><h2>Runtime atual</h2><p>{context.mode === 'xrm' ? 'Model-driven app conectado pelo XRM do parent.' : context.mode === 'direct' ? 'URL direta autenticada e validada por WhoAmI.' : 'Mock local ativo. Nenhum dado demonstrativo é enviado ao Dataverse.'}</p><span className="badge neutral">{context.mode}</span></div></article></section>; }

function EntryDrawer({ entry, suggestion, onClose, onReconcile, readOnly }: { entry: CashflowEntry; suggestion?: { forecast: CashflowEntry }; onClose: () => void; onReconcile: (actualId: string, forecastId: string) => void; readOnly: boolean }) { return <><button className="drawer-backdrop" aria-label="Fechar detalhe" onClick={onClose} /><aside className="drawer" aria-label="Detalhe do lançamento"><header><div><p className="eyebrow">LANÇAMENTO</p><h2>Detalhe financeiro</h2></div><button className="icon-button" onClick={onClose} aria-label="Fechar"><X size={18} /></button></header><div className="drawer-content"><span className={`status-line ${entry.status}`}>{entry.status === 'reconciled' ? <CheckCircle2 /> : <Clock3 />}{entry.status === 'reconciled' ? 'Conciliado' : 'Pendente de conciliação'}</span><h3>{entry.description}</h3><strong className={entry.nature === 'outflow' ? 'amount negative' : 'amount'}>{entry.nature === 'outflow' ? '−' : '+'}{currency.format(entry.amount)}</strong><dl><div><dt>Data</dt><dd>{formatDate(entry.date)}</dd></div><div><dt>Categoria</dt><dd>{entry.category}</dd></div><div><dt>Origem</dt><dd>{entry.source === 'ofx' ? 'Importação OFX' : entry.source === 'order' ? 'OP ativa' : entry.source === 'recurrence' ? 'Recorrência' : 'Previsão manual'}</dd></div><div><dt>Conta</dt><dd>{entry.account ?? '—'}</dd></div></dl>{entry.source === 'ofx' && <div className="original-box"><small>Original OFX</small><p>{entry.originalDescription ?? entry.description}<br />{entry.originalDate ? formatDate(entry.originalDate) : formatDate(entry.date)}</p></div>}</div>{suggestion && <footer><p><Sparkles size={16} />Previsão compatível encontrada: {suggestion.forecast.description}</p><button className="button primary" onClick={() => onReconcile(entry.id, suggestion.forecast.id)} disabled={readOnly}>Confirmar conciliação 1:1</button></footer>}</aside></>; }

function ManualModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) { return <div className="modal-layer" role="dialog" aria-modal="true" aria-label="Nova previsão"><button className="drawer-backdrop" aria-label="Fechar" onClick={onClose} /><form className="modal" onSubmit={onSubmit}><header><div><p className="eyebrow">PREVISÃO</p><h2>Novo lançamento manual</h2></div><button className="icon-button" type="button" onClick={onClose}><X size={18} /></button></header><label>Descrição<input name="description" required placeholder="Ex.: Manutenção programada" /></label><div className="form-row"><label>Valor (BRL)<input name="amount" required inputMode="decimal" placeholder="0,00" /></label><label>Data<input name="date" required type="date" defaultValue={new Date().toISOString().slice(0, 10)} /></label></div><div className="form-row"><label>Natureza<select name="nature" defaultValue="outflow"><option value="outflow">Saída</option><option value="inflow">Entrada</option></select></label><label>Categoria<select name="category" defaultValue="Administrativo"><option>Administrativo</option><option>Frota</option><option>Pessoal</option><option>Recebimentos de clientes</option></select></label></div><p className="form-note">Este formulário cria somente previsão. Realizados entram por OFX.</p><footer><button className="button secondary" type="button" onClick={onClose}>Cancelar</button><button className="button primary" type="submit">Criar previsão</button></footer></form></div>; }

function OfxModal({ ofx, account, onAccount, onClose, onSelect, onConfirm }: { ofx: OfxImportResult | null; account: string; onAccount: (value: string) => void; onClose: () => void; onSelect: (event: ChangeEvent<HTMLInputElement>) => void; onConfirm: () => void }) { return <div className="modal-layer" role="dialog" aria-modal="true" aria-label="Importar OFX"><button className="drawer-backdrop" aria-label="Fechar" onClick={onClose} /><div className="modal ofx-modal"><header><div><p className="eyebrow">BANCO</p><h2>Importar OFX</h2></div><button className="icon-button" onClick={onClose}><X size={18} /></button></header>{!ofx ? <label className="dropzone"><FileUp size={28} /><strong>Selecione um arquivo OFX</strong><span>Um arquivo por vez. A importação será atômica.</span><input type="file" accept=".ofx,.qfx,text/ofx" onChange={onSelect} /></label> : <><div className="import-summary"><Landmark /><div><strong>{ofx.transactions.length} transações encontradas</strong><small>Conta {ofx.accountId ?? 'não identificada'} · BRL</small></div></div><label>Conta bancária<select value={account} onChange={(event) => onAccount(event.target.value)}><option>Itaú · 4521</option><option>Bradesco · 8801</option><option>Conta OFX · {ofx.accountId ?? 'nova'}</option></select></label><p className="form-note">Transações entram como pendentes e ficam fora do cálculo até conciliação. Valores do OFX não podem ser editados.</p><footer><button className="button secondary" onClick={onClose}>Cancelar</button><button className="button primary" onClick={onConfirm}>Importar {ofx.transactions.length} transações</button></footer></>}</div></div>; }

createRoot(document.getElementById('root')!).render(<App />);

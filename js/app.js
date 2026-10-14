import * as C from './core.js';
import { loadData, saveData, requestPersistence, exportJSON, backupFileName, parseImport, uid } from './store.js';
import { barChart, lineChart, hBars } from './charts.js';

/* ================= Estado ================= */

let data;
let state;
const ui = {
  hist: { period: 'semana', key: null, filter: 'todo' },
  closeWeek: null,
  statsRange: 'todo',
  installEvent: null,
};

const nowISO = () => C.toLocalISO(new Date());
const money = (c, o) => C.formatRD(c, o);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const icon = (name, cls = '') => `<svg aria-hidden="true" class="${cls}"><use href="#i-${name}"/></svg>`;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const BUCKET_COLOR = { salidas: 'var(--c-salidas)', personal: 'var(--c-personal)', reserva: 'var(--c-reserva)' };
const ALLOC_KEYS = ['salidas', 'personal', 'reserva', 'ahorro'];

function recompute() {
  state = C.computeState(data, nowISO());
}

// Aplica un cambio, lo guarda y vuelve a calcular todo. Si el guardado falla, se revierte.
function commit(mutate, message, { undo = true } = {}) {
  const before = JSON.stringify(data);
  try {
    mutate(data);
    saveData(data);
  } catch (e) {
    data = JSON.parse(before);
    toast('No se pudo guardar: ' + e.message);
    return false;
  }
  recompute();
  render();
  if (message) {
    toast(
      message,
      undo
        ? () => {
            data = JSON.parse(before);
            saveData(data);
            recompute();
            render();
            toast('Cambio deshecho');
          }
        : null,
    );
  }
  return true;
}

/* ================= Utilidades de interfaz ================= */

let toastTimer;
function toast(msg, onUndo) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${onUndo ? '<button type="button">Deshacer</button>' : ''}`;
  if (onUndo) $('button', el).onclick = () => { el.classList.remove('show'); onUndo(); };
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), onUndo ? 6000 : 3200);
}

function openSheet({ title, body, foot = '', onMount }) {
  const dlg = $('#sheet');
  dlg.innerHTML = `<div class="sheet-head"><h2 id="sheet-title">${esc(title)}</h2>
    <button type="button" class="icon-btn" data-close aria-label="Cerrar">${icon('x')}</button></div>
    <div class="sheet-body">${body}</div>${foot ? `<div class="sheet-foot">${foot}</div>` : ''}`;
  $('[data-close]', dlg).onclick = () => dlg.close();
  if (!dlg.open) dlg.showModal();
  onMount && onMount(dlg);
  return dlg;
}
const closeSheet = () => $('#sheet').open && $('#sheet').close();

function confirmDialog({ title, body, confirmText = 'Confirmar', danger = false, extra = null, cancelText = 'Cancelar' }) {
  return new Promise((resolve) => {
    const dlg = $('#confirm');
    dlg.innerHTML = `<div class="sheet-head"><h2 id="confirm-title">${esc(title)}</h2></div>
      <div class="sheet-body">${body}</div>
      <div class="sheet-foot">
        <button type="button" class="btn ${danger ? 'danger' : 'primary'} block" data-r="ok">${esc(confirmText)}</button>
        ${extra ? `<button type="button" class="btn secondary block" data-r="extra">${esc(extra)}</button>` : ''}
        <button type="button" class="btn ghost block" data-r="cancel">${esc(cancelText)}</button>
      </div>`;
    let result = null;
    $$('[data-r]', dlg).forEach((b) => (b.onclick = () => { result = b.dataset.r; dlg.close(); }));
    dlg.onclose = () => resolve(result === 'ok' ? 'ok' : result === 'extra' ? 'extra' : null);
    dlg.showModal();
    $('[data-r="cancel"]', dlg).focus();
  });
}

const notice = (kind, iconName, html) => `<div class="notice ${kind}">${icon(iconName)}<div class="grow">${html}</div></div>`;

function amountField({ name = 'amount', label = 'Importe', value = '', hint = '', autofocus = false }) {
  return `<div class="field"><label for="f-${name}">${esc(label)}</label>
    <div class="amount-input"><span aria-hidden="true">RD$</span>
    <input id="f-${name}" name="${name}" inputmode="decimal" autocomplete="off" enterkeyhint="done" placeholder="0" value="${esc(value)}" ${autofocus ? 'autofocus' : ''} aria-describedby="e-${name}"></div>
    <p class="err" id="e-${name}" aria-live="polite"></p>${hint ? `<p class="hint">${hint}</p>` : ''}</div>`;
}

function moneyRow(name, label, cents) {
  return `<div class="money-row"><label for="f-${name}">${esc(label)}</label>
    <input id="f-${name}" name="${name}" inputmode="decimal" autocomplete="off" value="${esc(C.centsToInput(cents) || '0')}"></div>`;
}

const readCents = (form, name) => C.parseAmount(form.elements[name]?.value ?? '');

function setErr(form, name, msg) {
  const e = $(`#e-${name}`, form);
  if (e) e.textContent = msg || '';
  const inp = form.elements[name];
  if (inp) inp.setAttribute('aria-invalid', msg ? 'true' : 'false');
}

function catName(id) {
  return C.categoryName(data, id);
}

function levelClass(pct) {
  const l = C.usageLevel(pct);
  return l ? `l${l}` : '';
}

function levelBadge(pct) {
  const l = C.usageLevel(pct);
  if (!l) return '';
  const txt = l === 100 ? (pct > 100 ? 'Excedido' : 'Agotado') : `${l} % usado`;
  return `<span class="level-badge l${l}">${txt}</span>`;
}

/* ================= Filas de movimientos ================= */

function mvRow(m, withDay = true) {
  let ic = 'tag';
  let cls = '';
  let title = '';
  let detail = '';
  let amount = '';
  let aCls = '';
  const time = withDay ? `${C.dayLabel(C.dayKeyOf(m.date))} · ${C.timeOf(m.date)}` : C.timeOf(m.date);
  switch (m.type) {
    case 'expense':
      title = m.description || catName(m.categoryId);
      detail = `${m.description ? esc(catName(m.categoryId)) + ' · ' : ''}${C.METHODS[m.method]} · ${time}`;
      amount = '−' + money(m.amount);
      if (m.kind === 'impulsivo') title = `${esc(title)}<span class="tag">Impulsivo</span>`;
      else title = esc(title);
      return row();
    case 'allowance':
      ic = 'calendar'; cls = 'in'; aCls = 'in';
      title = 'Mesada semanal';
      detail = `${C.sumValues(m.extra) ? `Incluye ${money(C.sumValues(m.extra))} extra · ` : ''}${time}`;
      amount = '+' + money(m.amount);
      break;
    case 'income':
      ic = 'gift'; cls = 'in'; aCls = 'in';
      title = 'Ingreso extra: ' + esc(m.source);
      detail = time;
      amount = '+' + money(m.amount);
      break;
    case 'transfer':
      ic = 'swap'; cls = 'tr'; aCls = 'tr';
      title = `${C.SHORT_NAMES[m.from]} → ${C.SHORT_NAMES[m.to]}`;
      detail = `${m.closeOf ? 'Cierre semanal' : m.note ? esc(m.note) : 'Transferencia'} · ${time}`;
      amount = money(m.amount);
      break;
    case 'opening':
      ic = 'wallet'; cls = 'tr'; aCls = 'tr';
      title = 'Saldo inicial · ' + C.SHORT_NAMES[m.account];
      detail = time;
      amount = money(m.amount);
      break;
    case 'adjust':
      ic = 'sliders'; cls = 'tr'; aCls = 'tr';
      title = 'Ajuste · ' + C.SHORT_NAMES[m.account];
      detail = `${esc(m.note)} · ${time}`;
      amount = money(m.delta, { sign: true });
      break;
  }
  return row();
  function row() {
    return `<li><button type="button" class="mv" data-mv="${esc(m.id)}">
      <span class="ic ${cls}">${icon(ic)}</span>
      <span class="body"><span class="t" style="display:block">${title}</span><span class="d" style="display:block">${detail}</span></span>
      <span class="a num ${aCls}">${amount}</span></button></li>`;
  }
}

function bindMovementClicks(root) {
  $$('[data-mv]', root).forEach((b) => (b.onclick = () => openMovement(b.dataset.mv)));
}

function openMovement(id) {
  const m = data.movements.find((x) => x.id === id);
  if (!m) return;
  if (m.type === 'expense') return openExpenseSheet({ edit: m });
  if (m.type === 'allowance') return openAllowanceSheet({ edit: m });
  if (m.type === 'income') return openIncomeSheet({ edit: m });
  if (m.type === 'transfer') {
    if (m.closeOf) {
      return openSheet({
        title: 'Transferencia del cierre',
        body: `<div class="kv"><div class="r"><span>Importe</span><strong>${money(m.amount)}</strong></div>
          <div class="r"><span>De</span><strong>${C.ACCOUNT_NAMES[m.from]}</strong></div>
          <div class="r"><span>A</span><strong>${C.ACCOUNT_NAMES[m.to]}</strong></div></div>
          ${notice('info', 'alert', `<p>Se creó al cerrar la semana del ${C.weekLabel(m.closeOf)}. Para cambiarla, reabre esa semana desde <strong>Cierre semanal</strong>.</p>`)}`,
        foot: `<a class="btn secondary block" href="#/cierre?w=${m.closeOf}">Ir al cierre de esa semana</a>`,
        onMount: (d) => ($('a', d).onclick = () => d.close()),
      });
    }
    return openTransferSheet({ edit: m });
  }
  if (m.type === 'opening') return openOpeningSheet(m.account);
  if (m.type === 'adjust') {
    return openSheet({
      title: 'Ajuste',
      body: `<div class="kv"><div class="r"><span>Cuenta</span><strong>${C.ACCOUNT_NAMES[m.account]}</strong></div>
        <div class="r"><span>Cambio</span><strong>${money(m.delta, { sign: true })}</strong></div>
        <div class="r"><span>Motivo</span><strong>${esc(m.note)}</strong></div></div>`,
      foot: `<button type="button" class="btn danger-ghost block" id="del">Eliminar ajuste</button>`,
      onMount: (d) =>
        ($('#del', d).onclick = async () => {
          if ((await confirmDialog({ title: '¿Eliminar este ajuste?', body: '<p>El saldo volverá a calcularse sin él.</p>', confirmText: 'Eliminar', danger: true })) !== 'ok') return;
          d.close();
          commit((x) => (x.movements = x.movements.filter((y) => y.id !== m.id)), 'Ajuste eliminado');
        }),
    });
  }
}

/* ================= Router ================= */

const ROUTES = {
  inicio: viewInicio,
  movimientos: viewMovimientos,
  ahorro: viewAhorro,
  mas: viewMas,
  cierre: viewCierre,
  estadisticas: viewEstadisticas,
  deseos: viewDeseos,
  categorias: viewCategorias,
  ajustes: viewAjustes,
  datos: viewDatos,
  instalar: viewInstalar,
};
const TAB_OF = { inicio: 'inicio', movimientos: 'movimientos', ahorro: 'ahorro', mas: 'mas', cierre: 'mas', estadisticas: 'mas', deseos: 'mas', categorias: 'mas', ajustes: 'mas', datos: 'mas', instalar: 'mas' };

function route() {
  const raw = location.hash.replace(/^#\/?/, '') || 'inicio';
  const [name, qs] = raw.split('?');
  const params = new URLSearchParams(qs || '');
  return { name: ROUTES[name] ? name : 'inicio', params };
}

function render() {
  const { name, params } = route();
  $$('.tabbar a').forEach((a) => (a.dataset.tab === TAB_OF[name] ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  const view = $('#view');
  const scroll = window.scrollY;
  const prevRoute = view.dataset.route;
  ROUTES[name](view, params);
  view.dataset.route = name;
  bindMovementClicks(view);
  if (prevRoute === name) window.scrollTo(0, scroll);
}

function topbar(title, sub = '', back = '') {
  $('#topbar').innerHTML = `<div class="inline" style="gap:10px;min-width:0">
    ${back ? `<a class="icon-btn" href="${back}" aria-label="Volver">${icon('chev-l')}</a>` : ''}
    <div style="min-width:0"><h1>${esc(title)}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div></div>`;
}

/* ================= Inicio ================= */

function viewInicio(view) {
  const wk = state.currentWeek;
  const w = state.weeks[wk];
  const now = state.now;
  const days = C.daysUntilNextMonday(now);
  topbar('Mi mesada', `Semana ${C.weekLabel(wk)} · ${days === 1 ? 'mañana recibes la mesada' : `faltan ${days} días para la mesada`}`);

  if (!data.setupDone) return viewOnboarding(view);

  const pace = C.weekPace(w, now);
  const statusTxt = { ok: 'Vas bien', warn: 'Vas rápido', over: 'Excedido' }[pace.status];
  const statusLong = {
    ok: 'Estás cumpliendo el presupuesto.',
    warn: `Llevas ${money(w.spent - pace.expected)} más de lo que tocaba hasta hoy.`,
    over: w.spent > w.totalBudget ? `Gastaste ${money(w.spent - w.totalBudget)} más que tu presupuesto.` : `Te pasaste en ${C.BUCKETS.filter((b) => w.byBucket[b] > w.budget[b]).map((b) => C.SHORT_NAMES[b]).join(' y ')}.`,
  }[pace.status];
  const statusIcon = { ok: 'check', warn: 'alert', over: 'alert' }[pace.status];
  const spentPct = w.totalBudget > 0 ? Math.min(100, (w.spent / w.totalBudget) * 100) : w.spent > 0 ? 100 : 0;
  const tickPct = w.totalBudget > 0 ? Math.min(100, (pace.expected / w.totalBudget) * 100) : 0;
  const spendable = state.spendable;
  const goal = data.settings.savingsGoal;
  const sav = state.balances.ahorro;

  let html = '<div class="stack">';

  if (w.allowanceCount === 0) {
    html += notice(
      'info',
      'calendar',
      `<h3>¿Ya recibiste la mesada de esta semana?</h3>
      <p class="small muted mt4">Al registrarla se separan ${money(data.settings.plan.ahorro)} para tu ahorro y se reparte el resto.</p>
      <div class="actions"><button type="button" class="btn primary sm" id="quick-allow">Registrar ${money(data.settings.allowance)}</button>
      <button type="button" class="btn secondary sm" id="other-allow">Otro importe</button></div>`,
    );
  }

  // Avisos de cierre pendiente
  const prevKey = C.addDays(wk, -7);
  const prevW = state.weeks[prevKey];
  if (C.dayIndex(now) === 6 && !w.closed) {
    html += notice('info', 'check', `<h3>Hoy es domingo</h3><p class="small mt4">Haz el cierre de la semana para decidir qué hacer con lo que te sobró.</p><div class="actions"><a class="btn primary sm" href="#/cierre">Hacer cierre semanal</a></div>`);
  } else if (prevW && prevW.hasActivity && !prevW.closed) {
    html += notice('warn', 'clock', `<h3>La semana ${C.weekLabel(prevKey)} no está cerrada</h3><p class="small mt4">Lo que sobró se ha pasado a esta semana. Puedes cerrarla para mover sobrantes al ahorro o al fondo de salidas.</p><div class="actions"><a class="btn secondary sm" href="#/cierre?w=${prevKey}">Cerrar esa semana</a></div>`);
  }

  html += `<section class="card hero" aria-labelledby="h-disp">
    <div class="between"><p class="label" id="h-disp">Disponible para gastar</p>
      <span class="pill ${pace.status}">${icon(statusIcon)}${statusTxt}</span></div>
    <p class="big num ${spendable < 0 ? 'neg' : ''}">${money(spendable)}</p>
    <p class="muted small">${spendable > 0 ? `Unos <strong>${money(pace.perDay)}</strong> por día durante ${pace.daysLeft} ${pace.daysLeft === 1 ? 'día' : 'días'} (hasta el domingo).` : spendable < 0 ? 'Has gastado más de lo que tenías disponible.' : 'No te queda dinero para gastar esta semana.'}</p>
    <div class="mt12">
      <p class="small"><strong>${statusLong}</strong></p>
      <div class="between small mt4"><span>Gastado ${money(w.spent)} de ${money(w.totalBudget)}</span><span class="muted">${Math.round(spentPct)} %</span></div>
      <div class="bar mt4 ${pace.status === 'over' ? 'l100' : pace.status === 'warn' ? 'l75' : ''}" role="progressbar" aria-label="Gastado esta semana" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(spentPct)}">
        <span style="width:${spentPct}%"></span><i class="tick" style="left:${tickPct}%" title="Lo que tocaba haber gastado hasta hoy"></i></div>
      <p class="small muted mt4">La marca indica lo que tocaba gastar hasta hoy: ${money(pace.expected)}.</p>
    </div>
  </section>`;

  html += `<div class="kpis four">
    <div class="kpi"><p class="k">Recibido esta semana</p><p class="v num">${money(w.allowance + w.extraIncome)}</p><p class="s">${w.extraIncome ? `${money(w.extraIncome)} extra` : 'Mesada'}</p></div>
    <div class="kpi"><p class="k">Gastado esta semana</p><p class="v num">${money(w.spent)}</p><p class="s">${w.impulsive ? `${money(w.impulsive)} impulsivo` : `${w.expenseCount} ${w.expenseCount === 1 ? 'gasto' : 'gastos'}`}</p></div>
    <div class="kpi"><p class="k">Ahorrado esta semana</p><p class="v num">${money(w.savingsNet)}</p><p class="s">${w.savingsMet ? '✓ Objetivo cumplido' : `Objetivo ${money(w.savingsTarget)}`}</p></div>
    <a class="kpi card-link" href="#/ahorro"><p class="k">Ahorro total</p><p class="v num">${money(sav)}</p><p class="s">${Math.min(100, Math.round((sav / goal) * 100))} % de ${money(goal)}</p></a>
  </div>`;

  // Presupuestos
  html += `<section class="section" aria-labelledby="h-pres"><div class="head"><h2 id="h-pres">Lo que te queda por categoría</h2></div><div class="stack">`;
  for (const b of C.BUCKETS) {
    const left = state.balances[b];
    const budget = w.budget[b];
    const spent = w.byBucket[b];
    const pct = w.usage[b];
    const cats = data.categories.filter((c) => c.bucket === b && !c.archived).map((c) => c.name);
    html += `<article class="card bucket">
      <div class="row"><span class="name"><i class="dot" style="background:${BUCKET_COLOR[b]}"></i>${C.ACCOUNT_NAMES[b]}</span>${levelBadge(pct)}</div>
      <div class="row mt4"><span class="left num ${left < 0 ? 'neg' : ''}">${money(left)}</span><span class="muted small num">de ${money(budget)}</span></div>
      <div class="bar mt8 ${levelClass(pct)}" role="progressbar" aria-label="Uso de ${C.ACCOUNT_NAMES[b]}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(Math.min(pct, 100))}"><span style="width:${Math.min(100, pct)}%"></span></div>
      <div class="meta"><span>Gastado ${money(spent)} · ${Math.round(pct)} %</span><span>${w.opening[b] ? `Arrastre ${money(w.opening[b])}` : ''}</span></div>
      ${cats.length ? `<p class="small muted mt4">${esc(cats.join(' · '))}</p>` : ''}
    </article>`;
  }
  html += '</div></section>';

  // Deseos listos
  const ready = data.wishes.filter((x) => C.wishIsReady(x, now));
  if (ready.length) {
    html += '<div class="section stack">';
    for (const x of ready) {
      html += notice('good', 'clock', `<h3>Ya pasaron 24 h: ${esc(x.name)} (${money(x.amount)})</h3><p class="small mt4">¿Todavía lo quieres? Si lo compras, te quedarían ${money(state.spendable - x.amount)} para gastar.</p>
        <div class="actions"><button type="button" class="btn primary sm" data-wish-buy="${x.id}">Comprarlo</button><button type="button" class="btn secondary sm" data-wish-drop="${x.id}">Ya no lo quiero</button></div>`);
    }
    html += '</div>';
  }

  // Fondos
  html += `<section class="section" aria-labelledby="h-fondos"><div class="head"><h2 id="h-fondos">Fondos separados</h2><a class="small" href="#/ahorro">Ver</a></div>
    <div class="funds">
      <div class="kpi"><p class="k">Fondo para salidas</p><p class="v num">${money(state.balances.fondoSalidas)}</p><p class="s">Acumulado</p></div>
      <div class="kpi"><p class="k">Objetivos personales</p><p class="v num">${money(state.balances.objetivos)}</p><p class="s">Dinero extra</p></div>
      <div class="kpi"><p class="k">Inversiones</p><p class="v num">${money(state.balances.inversion)}</p><p class="s">En bolsa, aparte</p></div>
    </div></section>`;

  // Acciones rápidas
  html += `<section class="section" aria-label="Acciones rápidas"><div class="actions-grid">
    <button type="button" class="qa" id="qa-income">${icon('gift')}Ingreso extra</button>
    <button type="button" class="qa" id="qa-transfer">${icon('swap')}Mover dinero</button>
    <button type="button" class="qa" id="qa-wish">${icon('clock')}Esperar 24 h</button>
    <a class="qa" href="#/cierre">${icon('check')}Cierre semanal</a>
  </div></section>`;

  // Recientes
  const recent = C.sortMovements(data.movements).reverse().slice(0, 5);
  html += `<section class="section" aria-labelledby="h-rec"><div class="head"><h2 id="h-rec">Últimos movimientos</h2>${recent.length ? '<a class="small" href="#/movimientos">Ver todo</a>' : ''}</div>`;
  html += recent.length
    ? `<ul class="list">${recent.map(mvRow).join('')}</ul>`
    : `<div class="card empty">${icon('list')}<h3>Aún no hay movimientos</h3><p class="small">Registra tu mesada y tus gastos; aquí verás los últimos.</p></div>`;
  html += '</section></div>';

  view.innerHTML = html;
  $('#quick-allow', view) && ($('#quick-allow', view).onclick = quickAllowance);
  $('#other-allow', view) && ($('#other-allow', view).onclick = () => openAllowanceSheet({}));
  $('#qa-income', view).onclick = () => openIncomeSheet({});
  $('#qa-transfer', view).onclick = () => openTransferSheet({});
  $('#qa-wish', view).onclick = () => openWishSheet();
  bindWishActions(view);
}

function quickAllowance() {
  const amount = data.settings.allowance;
  const s = C.suggestAllowanceSplit(amount, data.settings);
  const m = { id: uid(), type: 'allowance', date: nowISO(), amount, alloc: s.alloc, extra: s.extra, note: '', createdAt: Date.now() };
  const errs = C.validateMovement(m, data);
  if (errs.length) return toast(errs[0]);
  commit((d) => d.movements.push(m), `Mesada registrada: ${money(s.alloc.ahorro)} al ahorro`);
}

function viewOnboarding(view) {
  view.innerHTML = `<form class="card stack" id="setup" novalidate>
    <div><h2>Bienvenido</h2><p class="muted small mt4">Configura tus saldos de partida. Podrás cambiarlos luego de forma controlada en Ahorro.</p></div>
    ${amountField({ name: 'ahorro', label: '¿Cuánto tienes ya ahorrado (líquido)?', value: '0', hint: 'Dinero ahorrado que no está invertido.' })}
    ${amountField({ name: 'inversion', label: 'Dinero invertido en bolsa', value: '8500', hint: 'Se registra aparte: no cuenta como ahorro líquido ni como dinero para gastar.' })}
    ${amountField({ name: 'fondo', label: 'Dinero guardado para salidas (opcional)', value: '0' })}
    ${amountField({ name: 'mesada', label: 'Tu mesada habitual cada lunes', value: C.centsToInput(data.settings.allowance) })}
    <button class="btn primary block" type="submit">Empezar</button>
    <p class="small muted">Tus datos se guardan solo en este dispositivo.</p>
  </form>`;
  $('#setup').onsubmit = (e) => {
    e.preventDefault();
    const f = e.target;
    const vals = {};
    let bad = false;
    for (const k of ['ahorro', 'inversion', 'fondo', 'mesada']) {
      const v = f.elements[k].value.trim() === '' ? 0 : readCents(f, k);
      if (v == null || (k === 'mesada' && v <= 0)) {
        setErr(f, k, k === 'mesada' ? 'Escribe un importe mayor que RD$0.' : 'Escribe un importe válido (sin signo negativo).');
        bad = true;
      } else setErr(f, k, '');
      vals[k] = v;
    }
    if (bad) return;
    const date = `${state.currentWeek}T00:00`;
    commit(
      (d) => {
        if (vals.mesada !== d.settings.allowance) {
          // Escala el plan proporcionalmente a la nueva mesada habitual.
          const s = C.suggestAllowanceSplit(vals.mesada, d.settings);
          d.settings.allowance = vals.mesada;
          d.settings.plan = s.alloc;
          d.settings.weeklySavingsTarget = s.alloc.ahorro;
        }
        const add = (account, amount) => amount > 0 && d.movements.push({ id: uid(), type: 'opening', date, account, amount, note: 'Saldo inicial', createdAt: Date.now() });
        add('ahorro', vals.ahorro);
        add('inversion', vals.inversion);
        add('fondoSalidas', vals.fondo);
        d.setupDone = true;
        d.log.push({ date: nowISO(), text: 'Configuración inicial' });
      },
      'Listo. Ahora registra tu mesada.',
      { undo: false },
    );
    requestPersistence();
  };
}

/* ================= Gasto ================= */

function openExpenseSheet({ edit = null, prefill = {} } = {}) {
  if (!data.setupDone) {
    location.hash = '#/inicio';
    return toast('Primero completa la configuración inicial.');
  }
  const m = edit || {};
  const cats = data.categories.filter((c) => !c.archived || c.id === m.categoryId);
  const catSel = m.categoryId || prefill.categoryId || '';
  const kind = m.kind || prefill.kind || 'planificado';
  const method = m.method || prefill.method || 'efectivo';
  const date = m.date || nowISO();
  // Para editar, el impacto se calcula sin el gasto original.
  const base = edit ? C.computeState({ ...data, movements: data.movements.filter((x) => x.id !== edit.id) }, nowISO()) : state;

  const body = `<form id="exp-form" class="stack" novalidate>
    ${amountField({ value: m.amount ? C.centsToInput(m.amount) : prefill.amount ? C.centsToInput(prefill.amount) : '', autofocus: !edit })}
    <fieldset class="field" style="border:0;padding:0;margin:0"><legend class="label" style="font-size:.875rem;font-weight:600;margin-bottom:6px">Categoría</legend>
      <div class="chips">${cats.map((c) => `<label class="chip"><input type="radio" name="cat" value="${esc(c.id)}" ${c.id === catSel ? 'checked' : ''}><span>${esc(c.name)}</span></label>`).join('')}</div>
      <p class="err" id="e-cat"></p></fieldset>
    <div id="impact" aria-live="polite"></div>
    <fieldset class="field" style="border:0;padding:0;margin:0"><legend class="label" style="font-size:.875rem;font-weight:600;margin-bottom:6px">¿Lo tenías planificado?</legend>
      <div class="seg danger-on">${Object.entries(C.KINDS).map(([k, v]) => `<label class="chip"><input type="radio" name="kind" value="${k}" ${k === kind ? 'checked' : ''}><span>${v}</span></label>`).join('')}</div></fieldset>
    <fieldset class="field" style="border:0;padding:0;margin:0"><legend class="label" style="font-size:.875rem;font-weight:600;margin-bottom:6px">Método de pago</legend>
      <div class="seg">${Object.entries(C.METHODS).map(([k, v]) => `<label class="chip"><input type="radio" name="method" value="${k}" ${k === method ? 'checked' : ''}><span>${v}</span></label>`).join('')}</div></fieldset>
    <div class="field"><label for="f-desc">Descripción <span class="muted">(opcional)</span></label><input id="f-desc" name="desc" maxlength="80" placeholder="Ej.: Wendy's con Ana" value="${esc(m.description || prefill.description || '')}"></div>
    <div class="field"><label for="f-date">Fecha y hora</label><input id="f-date" name="date" type="datetime-local" value="${esc(date)}" required><p class="err" id="e-date"></p></div>
  </form>`;
  const foot = `<button type="submit" form="exp-form" class="btn primary block" id="exp-save">${edit ? 'Guardar cambios' : 'Guardar gasto'}</button>
    ${edit ? `<button type="button" class="btn danger-ghost block" id="exp-del">Eliminar gasto</button>` : `<button type="button" class="btn secondary block" id="exp-wish">${icon('clock')}Prefiero esperar 24 h</button>`}`;

  openSheet({
    title: edit ? 'Editar gasto' : 'Añadir gasto',
    body,
    foot,
    onMount: (dlg) => {
      const f = $('#exp-form', dlg);
      const read = () => {
        const amount = readCents(f, 'amount');
        const cat = data.categories.find((c) => c.id === f.elements.cat.value);
        const bucket = edit && cat && cat.id === edit.categoryId ? edit.bucket : cat?.bucket;
        return { amount, cat, bucket, date: f.elements.date.value };
      };
      const updateImpact = () => {
        const { amount, cat, bucket, date } = read();
        const box = $('#impact', dlg);
        if (!amount || amount <= 0 || !cat || !date) {
          box.innerHTML = `<p class="small muted">${!cat ? 'Elige una categoría para ver cómo afecta a tu semana.' : 'Escribe el importe para ver el impacto antes de guardar.'}</p>`;
          return;
        }
        const p = C.previewExpense(base, { amount, bucket, date });
        const warns = C.expenseWarnings(p, null);
        box.innerHTML = `<div class="impact">
          <div class="line"><span>Quedaría en ${C.SHORT_NAMES[bucket]}</span><strong class="${p.bucketAfter < 0 ? 'neg' : ''}">${money(p.bucketAfter)}</strong></div>
          <div class="bar thin ${levelClass(p.pctAfter)}"><span style="width:${Math.min(100, p.pctAfter)}%"></span></div>
          <div class="line"><span>Total disponible después</span><strong class="${p.totalAfter < 0 ? 'neg' : ''}">${money(p.totalAfter)}</strong></div>
          ${p.totalAfter > 0 && C.weekKeyOf(date) === base.currentWeek ? `<div class="line"><span>Para el resto de la semana</span><strong>${money(p.perDayAfter)}/día · ${p.daysLeft} ${p.daysLeft === 1 ? 'día' : 'días'}</strong></div>` : ''}
          ${warns.length ? `<div class="warn-list">${warns.map((x) => `<p class="small" style="color:var(--${x.level === 'danger' ? 'danger' : x.level === 'warn' ? 'warn' : 'text-2'});font-weight:600">${esc(x.text)}</p>`).join('')}</div>` : ''}
        </div>`;
      };
      f.addEventListener('input', updateImpact);
      f.addEventListener('change', updateImpact);
      updateImpact();

      let saving = false;
      f.onsubmit = async (e) => {
        e.preventDefault();
        if (saving) return; // evita doble registro por doble toque
        const { amount, cat, bucket, date } = read();
        let bad = false;
        if (amount == null || amount <= 0) { setErr(f, 'amount', 'Escribe un importe mayor que RD$0 (sin signo negativo).'); bad = true; } else setErr(f, 'amount', '');
        $('#e-cat', f).textContent = cat ? '' : 'Elige una categoría.';
        if (!cat) bad = true;
        if (!date) { setErr(f, 'date', 'Indica la fecha y hora.'); bad = true; } else setErr(f, 'date', '');
        if (bad) return f.querySelector('[aria-invalid="true"]')?.focus();
        const mv = {
          id: edit ? edit.id : uid(),
          type: 'expense',
          date,
          amount,
          categoryId: cat.id,
          bucket,
          method: f.elements.method.value,
          kind: f.elements.kind.value,
          description: f.elements.desc.value.trim(),
          createdAt: edit ? edit.createdAt : Date.now(),
          ...(edit?.wishId || prefill.wishId ? { wishId: edit?.wishId || prefill.wishId } : {}),
        };
        const errs = C.validateMovement(mv, data);
        if (errs.length) return toast(errs[0]);
        const p = C.previewExpense(base, { amount, bucket, date });
        const dup = C.findDuplicate(data.movements, mv);
        const warns = C.expenseWarnings(p, dup, { closedWeek: !!data.closes[C.weekKeyOf(date)] });
        const serious = warns.filter((x) => x.level !== 'info');
        saving = true;
        if (serious.length) {
          const r = await confirmDialog({
            title: 'Piénsalo un momento',
            body: `${warns.map((x) => notice(x.level === 'danger' ? 'danger' : x.level === 'warn' ? 'warn' : 'info', 'alert', `<p class="small">${esc(x.text)}</p>`)).join('')}
              <p class="small muted">Nada se cambia automáticamente: tú decides.</p>`,
            confirmText: edit ? 'Guardar de todos modos' : 'Registrar de todos modos',
            extra: !edit && !prefill.wishId ? 'Esperar 24 h antes de comprarlo' : null,
            cancelText: 'Volver al formulario',
          });
          if (r === 'extra') {
            saving = false;
            dlg.close();
            return saveWish({ name: mv.description || cat.name, amount, categoryId: cat.id });
          }
          if (r !== 'ok') { saving = false; return; }
        }
        dlg.close();
        commit(
          (d) => {
            if (edit) d.movements = d.movements.map((x) => (x.id === edit.id ? mv : x));
            else d.movements.push(mv);
            if (prefill.wishId) {
              const wsh = d.wishes.find((x) => x.id === prefill.wishId);
              if (wsh) Object.assign(wsh, { status: 'comprado', decidedAt: nowISO() });
            }
          },
          `${edit ? 'Gasto actualizado' : 'Gasto guardado'} · Disponible: ${money(p.totalAfter)}`,
        );
      };
      if (edit) {
        $('#exp-del', dlg).onclick = async () => {
          if ((await confirmDialog({ title: '¿Eliminar este gasto?', body: `<p>${money(edit.amount)} · ${esc(catName(edit.categoryId))}. Los saldos y estadísticas se recalcularán.</p>`, confirmText: 'Eliminar', danger: true })) !== 'ok') return;
          dlg.close();
          commit((d) => (d.movements = d.movements.filter((x) => x.id !== edit.id)), 'Gasto eliminado');
        };
      } else {
        $('#exp-wish', dlg).onclick = () => {
          const { amount, cat } = read();
          if (!amount || amount <= 0) { setErr(f, 'amount', 'Escribe el importe de lo que quieres comprar.'); return f.elements.amount.focus(); }
          dlg.close();
          saveWish({ name: f.elements.desc.value.trim() || cat?.name || 'Compra pendiente', amount, categoryId: cat?.id || null });
        };
      }
      if (!edit) setTimeout(() => f.elements.amount.focus(), 50);
    },
  });
}

/* ================= Mesada ================= */

function splitFields(prefix, keys, values, labels) {
  return keys.map((k) => moneyRow(`${prefix}-${k}`, labels[k], values[k] || 0)).join('');
}

function openAllowanceSheet({ edit = null } = {}) {
  const st = data.settings;
  const m = edit || { amount: st.allowance, date: nowISO(), ...C.suggestAllowanceSplit(st.allowance, st) };
  const labels = { salidas: 'Salidas', personal: 'Gastos personales', reserva: 'Reserva imprevistos', ahorro: 'Ahorro (se separa ya)' };
  const exLabels = { ahorro: 'Ahorro líquido', objetivos: 'Objetivos personales', fondoSalidas: 'Fondo para salidas', inversion: 'Inversiones' };
  openSheet({
    title: edit ? 'Editar mesada' : 'Registrar mesada',
    body: `<form id="al-form" class="stack" novalidate>
      ${amountField({ label: 'Importe recibido', value: C.centsToInput(m.amount) })}
      <div class="field"><label for="f-date">Fecha</label><input id="f-date" name="date" type="datetime-local" value="${esc(m.date)}"></div>
      <div id="al-note"></div>
      <div class="card stack" style="gap:10px"><h3>Presupuesto de la semana</h3>${splitFields('a', ALLOC_KEYS, m.alloc, labels)}</div>
      <div class="card stack" style="gap:10px" id="al-extra"><h3>Dinero extra</h3><p class="small muted">Por encima de tu mesada habitual. No aumenta tus límites de gasto.</p>${splitFields('x', C.EXTRA_DESTS, m.extra, exLabels)}</div>
      <div class="split-total" id="al-total"></div>
      <button type="button" class="btn ghost sm" id="al-reset">Restaurar reparto sugerido</button>
    </form>`,
    foot: `<button type="submit" form="al-form" class="btn primary block">${edit ? 'Guardar cambios' : 'Registrar mesada'}</button>
      ${edit ? '<button type="button" class="btn danger-ghost block" id="al-del">Eliminar mesada</button>' : ''}`,
    onMount: (dlg) => {
      const f = $('#al-form', dlg);
      const fill = (amount) => {
        const s = C.suggestAllowanceSplit(amount, st);
        ALLOC_KEYS.forEach((k) => (f.elements[`a-${k}`].value = C.centsToInput(s.alloc[k]) || '0'));
        C.EXTRA_DESTS.forEach((k) => (f.elements[`x-${k}`].value = C.centsToInput(s.extra[k]) || '0'));
      };
      const collect = () => {
        const alloc = {};
        const extra = {};
        let invalid = false;
        ALLOC_KEYS.forEach((k) => { const v = f.elements[`a-${k}`].value.trim() === '' ? 0 : readCents(f, `a-${k}`); if (v == null) invalid = true; alloc[k] = v || 0; });
        C.EXTRA_DESTS.forEach((k) => { const v = f.elements[`x-${k}`].value.trim() === '' ? 0 : readCents(f, `x-${k}`); if (v == null) invalid = true; extra[k] = v || 0; });
        return { amount: readCents(f, 'amount'), alloc, extra, invalid };
      };
      const update = () => {
        const { amount, alloc, extra, invalid } = collect();
        const tot = C.sumValues(alloc) + C.sumValues(extra);
        const el = $('#al-total', dlg);
        if (amount == null || amount <= 0) {
          el.className = 'split-total bad'; el.textContent = 'Escribe un importe mayor que RD$0.';
        } else if (invalid) {
          el.className = 'split-total bad'; el.textContent = 'Hay un importe no válido en el reparto.';
        } else if (tot === amount) {
          el.className = 'split-total good'; el.innerHTML = `<span>Repartido</span><span class="num">${money(tot)} ✓</span>`;
        } else {
          el.className = 'split-total bad'; el.innerHTML = `<span>${tot < amount ? 'Falta repartir' : 'Sobra en el reparto'}</span><span class="num">${money(Math.abs(amount - tot))}</span>`;
        }
        let note = '';
        if (amount > st.allowance) note = notice('info', 'gift', `<p class="small">Recibiste ${money(amount - st.allowance)} más de lo habitual. Tu presupuesto sigue en ${money(st.allowance)}; el extra se sugiere ${st.extraSplit.ahorro} % ahorro / ${100 - st.extraSplit.ahorro} % objetivos. Puedes cambiarlo.</p>`);
        else if (amount > 0 && amount < st.allowance) note = notice('warn', 'alert', `<p class="small">Recibiste ${money(st.allowance - amount)} menos de lo habitual. El presupuesto de esta semana se reduce proporcionalmente; puedes ajustarlo. Las semanas anteriores no cambian.</p>`);
        $('#al-note', dlg).innerHTML = note;
        $('#al-extra', dlg).hidden = !(amount > st.allowance || C.sumValues(extra) > 0);
      };
      f.elements.amount.addEventListener('input', () => { const a = readCents(f, 'amount'); if (a > 0) fill(a); update(); });
      f.addEventListener('input', (e) => e.target.name !== 'amount' && update());
      $('#al-reset', dlg).onclick = () => { const a = readCents(f, 'amount'); if (a > 0) fill(a); update(); };
      update();
      f.onsubmit = async (e) => {
        e.preventDefault();
        const { amount, alloc, extra } = collect();
        const mv = { id: edit ? edit.id : uid(), type: 'allowance', date: f.elements.date.value, amount: amount ?? 0, alloc, extra, note: '', createdAt: edit ? edit.createdAt : Date.now() };
        const errs = C.validateMovement(mv, data);
        if (errs.length) { setErr(f, 'amount', errs[0]); return; }
        const sameWeek = data.movements.filter((x) => x.type === 'allowance' && x.id !== mv.id && C.weekKeyOf(x.date) === C.weekKeyOf(mv.date));
        if (sameWeek.length) {
          const r = await confirmDialog({ title: 'Ya hay una mesada esa semana', body: `<p>Registraste ${money(sameWeek[0].amount)} el ${C.dayLabel(C.dayKeyOf(sameWeek[0].date))}. ¿Seguro que es otra mesada y no un duplicado? Si es dinero adicional, regístralo como <strong>ingreso extra</strong>.</p>`, confirmText: 'Sí, registrar otra' });
          if (r !== 'ok') return;
        }
        dlg.close();
        commit((d) => (edit ? (d.movements = d.movements.map((x) => (x.id === edit.id ? mv : x))) : d.movements.push(mv)), edit ? 'Mesada actualizada' : `Mesada registrada: ${money(alloc.ahorro + extra.ahorro)} al ahorro`);
      };
      if (edit) {
        $('#al-del', dlg).onclick = async () => {
          if ((await confirmDialog({ title: '¿Eliminar esta mesada?', body: `<p>Se quitarán ${money(edit.amount)} y su reparto. Los saldos se recalcularán.</p>`, confirmText: 'Eliminar', danger: true })) !== 'ok') return;
          dlg.close();
          commit((d) => (d.movements = d.movements.filter((x) => x.id !== edit.id)), 'Mesada eliminada');
        };
      }
    },
  });
}

/* ================= Ingreso extra ================= */

function openIncomeSheet({ edit = null } = {}) {
  const st = data.settings;
  const m = edit || { amount: 0, date: nowISO(), source: '', split: { ahorro: 0, objetivos: 0, fondoSalidas: 0, inversion: 0 } };
  const labels = { ahorro: 'Ahorro líquido', objetivos: 'Objetivos personales', fondoSalidas: 'Fondo para salidas', inversion: 'Inversiones' };
  openSheet({
    title: edit ? 'Editar ingreso extra' : 'Ingreso extra',
    body: `<form id="in-form" class="stack" novalidate>
      ${notice('info', 'gift', `<p class="small">Dinero que recibes aparte de la mesada (regalos, trabajos, ventas…). No aumenta tus límites de gasto. Si mueves dinero entre tus fondos, usa <strong>Mover dinero</strong>: no es un ingreso nuevo.</p>`)}
      ${amountField({ value: C.centsToInput(m.amount), autofocus: !edit })}
      <div class="field"><label for="f-source">Origen</label><input id="f-source" name="source" list="sources" maxlength="60" placeholder="Ej.: Regalo de cumpleaños" value="${esc(m.source)}"><p class="err" id="e-source"></p>
        <datalist id="sources"><option value="Regalo"><option value="Trabajo"><option value="Venta"><option value="Familia"><option value="Premio"></datalist></div>
      <div class="field"><label for="f-date">Fecha</label><input id="f-date" name="date" type="datetime-local" value="${esc(m.date)}"></div>
      <div class="card stack" style="gap:10px"><div class="between"><h3>¿A dónde va?</h3><button type="button" class="btn ghost sm" id="in-sug">Sugerido ${st.extraSplit.ahorro}/${100 - st.extraSplit.ahorro}</button></div>
        ${splitFields('s', C.EXTRA_DESTS, m.split, labels)}</div>
      <div class="split-total" id="in-total"></div>
    </form>`,
    foot: `<button type="submit" form="in-form" class="btn primary block">${edit ? 'Guardar cambios' : 'Registrar ingreso'}</button>
      ${edit ? '<button type="button" class="btn danger-ghost block" id="in-del">Eliminar ingreso</button>' : ''}`,
    onMount: (dlg) => {
      const f = $('#in-form', dlg);
      let touched = !!edit;
      const fill = () => {
        const a = readCents(f, 'amount');
        if (!(a > 0)) return;
        const s = C.suggestIncomeSplit(a, st);
        C.EXTRA_DESTS.forEach((k) => (f.elements[`s-${k}`].value = C.centsToInput(s[k]) || '0'));
      };
      const collect = () => {
        const split = {};
        let invalid = false;
        C.EXTRA_DESTS.forEach((k) => { const v = f.elements[`s-${k}`].value.trim() === '' ? 0 : readCents(f, `s-${k}`); if (v == null) invalid = true; split[k] = v || 0; });
        return { amount: readCents(f, 'amount'), split, invalid };
      };
      const update = () => {
        const { amount, split, invalid } = collect();
        const tot = C.sumValues(split);
        const el = $('#in-total', dlg);
        if (!(amount > 0)) { el.className = 'split-total muted'; el.textContent = ''; return; }
        if (invalid) { el.className = 'split-total bad'; el.textContent = 'Hay un importe no válido.'; return; }
        el.className = 'split-total ' + (tot === amount ? 'good' : 'bad');
        el.innerHTML = tot === amount ? `<span>Repartido</span><span class="num">${money(tot)} ✓</span>` : `<span>${tot < amount ? 'Falta repartir' : 'Sobra en el reparto'}</span><span class="num">${money(Math.abs(amount - tot))}</span>`;
      };
      f.elements.amount.addEventListener('input', () => { if (!touched) fill(); update(); });
      f.addEventListener('input', (e) => { if (e.target.name?.startsWith('s-')) touched = true; update(); });
      $('#in-sug', dlg).onclick = () => { fill(); update(); };
      update();
      f.onsubmit = (e) => {
        e.preventDefault();
        const { amount, split } = collect();
        const mv = { id: edit ? edit.id : uid(), type: 'income', date: f.elements.date.value, amount: amount ?? 0, source: f.elements.source.value.trim(), split, createdAt: edit ? edit.createdAt : Date.now() };
        const errs = C.validateMovement(mv, data);
        setErr(f, 'source', mv.source ? '' : 'Indica de dónde viene el dinero.');
        if (errs.length) { if (!(mv.amount > 0)) setErr(f, 'amount', errs[0]); else toast(errs[0]); return; }
        setErr(f, 'amount', '');
        dlg.close();
        commit((d) => (edit ? (d.movements = d.movements.map((x) => (x.id === edit.id ? mv : x))) : d.movements.push(mv)), edit ? 'Ingreso actualizado' : `Ingreso registrado · ${money(split.ahorro)} al ahorro`);
      };
      if (edit) {
        $('#in-del', dlg).onclick = async () => {
          if ((await confirmDialog({ title: '¿Eliminar este ingreso?', body: `<p>${money(edit.amount)} de “${esc(edit.source)}”. Los saldos se recalcularán.</p>`, confirmText: 'Eliminar', danger: true })) !== 'ok') return;
          dlg.close();
          commit((d) => (d.movements = d.movements.filter((x) => x.id !== edit.id)), 'Ingreso eliminado');
        };
      }
    },
  });
}

/* ================= Transferencias ================= */

function openTransferSheet({ edit = null, from = '', to = '', amount = 0, note = '' } = {}) {
  const m = edit || { from, to, amount, note, date: nowISO() };
  // Al editar, el saldo de origen incluye lo que ya se había movido.
  const avail = (acc) => state.balances[acc] + (edit && edit.from === acc ? edit.amount : 0) - (edit && edit.to === acc ? edit.amount : 0);
  const opts = (sel) => C.ACCOUNTS.map((a) => `<option value="${a}" ${a === sel ? 'selected' : ''}>${C.ACCOUNT_NAMES[a]} (${money(avail(a))})</option>`).join('');
  openSheet({
    title: edit ? 'Editar transferencia' : 'Mover dinero entre fondos',
    body: `<form id="tr-form" class="stack" novalidate>
      <p class="small muted">Mover dinero entre tus propios fondos no cuenta como gasto ni como ingreso. Ejemplos: usar el fondo de salidas para una salida grande, retirar del ahorro o aportar a inversiones.</p>
      <div class="field"><label for="f-from">Desde</label><select id="f-from" name="from"><option value="">Elige…</option>${opts(m.from)}</select></div>
      <div class="field"><label for="f-to">Hacia</label><select id="f-to" name="to"><option value="">Elige…</option>${opts(m.to)}</select></div>
      ${amountField({ value: C.centsToInput(m.amount) })}
      <div class="field"><label for="f-note">Nota <span class="muted">(opcional)</span></label><input id="f-note" name="note" maxlength="60" value="${esc(m.note || '')}" placeholder="Ej.: Para el cine del sábado"></div>
      <div class="field"><label for="f-date">Fecha</label><input id="f-date" name="date" type="datetime-local" value="${esc(m.date)}"></div>
    </form>`,
    foot: `<button type="submit" form="tr-form" class="btn primary block">${edit ? 'Guardar cambios' : 'Mover dinero'}</button>
      ${edit ? '<button type="button" class="btn danger-ghost block" id="tr-del">Eliminar transferencia</button>' : ''}`,
    onMount: (dlg) => {
      const f = $('#tr-form', dlg);
      f.onsubmit = async (e) => {
        e.preventDefault();
        const mv = { id: edit ? edit.id : uid(), type: 'transfer', date: f.elements.date.value, from: f.elements.from.value, to: f.elements.to.value, amount: readCents(f, 'amount') ?? 0, note: f.elements.note.value.trim(), createdAt: edit ? edit.createdAt : Date.now() };
        const errs = C.validateMovement(mv, data);
        if (errs.length) return setErr(f, 'amount', errs[0]);
        const tErr = C.validateTransfer(state, { from: mv.from, to: mv.to, amount: mv.amount, excludeAmount: edit && edit.from === mv.from ? edit.amount : 0 });
        if (tErr.length) return setErr(f, 'amount', tErr[0]);
        setErr(f, 'amount', '');
        if (mv.from === 'ahorro') {
          const r = await confirmDialog({ title: '¿Retirar de tus ahorros?', body: `<p>Vas a sacar ${money(mv.amount)} del ahorro líquido. Quedará registrado como retiro y contará en tu objetivo semanal.</p>`, confirmText: 'Sí, retirar' });
          if (r !== 'ok') return;
        }
        dlg.close();
        commit((d) => (edit ? (d.movements = d.movements.map((x) => (x.id === edit.id ? mv : x))) : d.movements.push(mv)), `${money(mv.amount)} movidos a ${C.SHORT_NAMES[mv.to]}`);
      };
      if (edit) {
        $('#tr-del', dlg).onclick = async () => {
          if ((await confirmDialog({ title: '¿Eliminar esta transferencia?', body: '<p>El dinero volverá a contarse en la cuenta de origen.</p>', confirmText: 'Eliminar', danger: true })) !== 'ok') return;
          dlg.close();
          commit((d) => (d.movements = d.movements.filter((x) => x.id !== edit.id)), 'Transferencia eliminada');
        };
      }
    },
  });
}

/* ================= Deseos (24 h) ================= */

function saveWish({ name, amount, categoryId }) {
  const w = { id: uid(), name, amount, categoryId, createdAt: nowISO(), status: 'pendiente' };
  commit((d) => d.wishes.push(w), `Guardado. Te lo recordaremos en 24 h`);
}

function openWishSheet() {
  const cats = data.categories.filter((c) => !c.archived);
  openSheet({
    title: 'Lo quiero… pero espero 24 h',
    body: `<form id="w-form" class="stack" novalidate>
      <p class="small muted">Anota lo que quieres comprar. Mañana a esta hora te preguntaremos si todavía lo quieres. No se descuenta nada hasta que decidas comprarlo.</p>
      <div class="field"><label for="f-name">¿Qué quieres comprar?</label><input id="f-name" name="name" maxlength="60" required placeholder="Ej.: Audífonos"><p class="err" id="e-name"></p></div>
      ${amountField({ label: 'Precio aproximado' })}
      <div class="field"><label for="f-cat">Categoría</label><select id="f-cat" name="cat">${cats.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select></div>
    </form>`,
    foot: '<button type="submit" form="w-form" class="btn primary block">Guardar y esperar 24 h</button>',
    onMount: (dlg) => {
      const f = $('#w-form', dlg);
      setTimeout(() => f.elements.name.focus(), 50);
      f.onsubmit = (e) => {
        e.preventDefault();
        const name = f.elements.name.value.trim();
        const amount = readCents(f, 'amount');
        setErr(f, 'name', name ? '' : 'Escribe qué quieres comprar.');
        setErr(f, 'amount', amount > 0 ? '' : 'Escribe un precio mayor que RD$0.');
        if (!name || !(amount > 0)) return;
        dlg.close();
        saveWish({ name, amount, categoryId: f.elements.cat.value });
      };
    },
  });
}

function bindWishActions(root) {
  $$('[data-wish-buy]', root).forEach((b) => (b.onclick = () => {
    const w = data.wishes.find((x) => x.id === b.dataset.wishBuy);
    openExpenseSheet({ prefill: { amount: w.amount, categoryId: w.categoryId, description: w.name, kind: 'planificado', wishId: w.id } });
  }));
  $$('[data-wish-drop]', root).forEach((b) => (b.onclick = () => {
    const id = b.dataset.wishDrop;
    commit((d) => Object.assign(d.wishes.find((x) => x.id === id), { status: 'descartado', decidedAt: nowISO() }), 'Bien hecho: no lo compraste');
  }));
  $$('[data-wish-del]', root).forEach((b) => (b.onclick = () => {
    const id = b.dataset.wishDel;
    commit((d) => (d.wishes = d.wishes.filter((x) => x.id !== id)), 'Deseo eliminado');
  }));
}

function viewDeseos(view) {
  topbar('Esperar 24 h', 'Piensa antes de comprar', '#/mas');
  const now = state.now;
  const pending = data.wishes.filter((x) => x.status === 'pendiente');
  const done = data.wishes.filter((x) => x.status !== 'pendiente').sort((a, b) => (a.decidedAt < b.decidedAt ? 1 : -1));
  const s = C.statsSummary(state, data);
  let html = `<div class="stack"><button type="button" class="btn primary block" id="new-wish">${icon('plus')}Añadir algo que quiero</button>`;
  if (s.avoidedCount) html += notice('good', 'check', `<p>Has evitado gastar <strong>${money(s.avoided)}</strong> en ${s.avoidedCount} ${s.avoidedCount === 1 ? 'compra' : 'compras'} gracias a esperar.</p>`);
  html += `<section class="section"><div class="head"><h2>Pendientes</h2></div>`;
  if (!pending.length) html += `<div class="card empty">${icon('clock')}<h3>Nada en espera</h3><p class="small">Cuando te provoque comprar algo no planificado, anótalo aquí y decide mañana.</p></div>`;
  else {
    html += '<div class="stack">';
    for (const x of pending) {
      const ready = C.wishIsReady(x, now);
      html += `<article class="card"><div class="between"><h3>${esc(x.name)}</h3><strong class="num">${money(x.amount)}</strong></div>
        <p class="small muted mt4">${esc(x.categoryId ? catName(x.categoryId) : '')} · ${ready ? 'Ya puedes decidir' : `Podrás decidir en ${C.hoursUntilReady(x, now)} h`}</p>
        <div class="inline mt8">${ready ? `<button type="button" class="btn primary sm" data-wish-buy="${x.id}">Comprarlo</button><button type="button" class="btn secondary sm" data-wish-drop="${x.id}">Ya no lo quiero</button>` : `<button type="button" class="btn secondary sm" data-wish-drop="${x.id}">Ya no lo quiero</button>`}
        <button type="button" class="btn danger-ghost sm" data-wish-del="${x.id}">Eliminar</button></div></article>`;
    }
    html += '</div>';
  }
  html += '</section>';
  if (done.length) {
    html += `<section class="section"><div class="head"><h2>Decididos</h2></div><ul class="list">${done
      .map((x) => `<li><div class="mv" style="cursor:default"><span class="ic ${x.status === 'descartado' ? 'in' : ''}">${icon(x.status === 'descartado' ? 'check' : 'tag')}</span><span class="body"><span class="t" style="display:block">${esc(x.name)}</span><span class="d" style="display:block">${x.status === 'descartado' ? 'No lo compraste' : 'Lo compraste'} · ${C.dayLabel(C.dayKeyOf(x.decidedAt || x.createdAt))}</span></span><span class="a num">${money(x.amount)}</span></div></li>`)
      .join('')}</ul></section>`;
  }
  html += '</div>';
  view.innerHTML = html;
  $('#new-wish', view).onclick = openWishSheet;
  bindWishActions(view);
}

/* ================= Historial ================= */

function shiftPeriod(period, key, dir) {
  if (period === 'dia') return C.addDays(key, dir);
  if (period === 'semana') return C.addDays(key, 7 * dir);
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + dir, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function currentKey(period) {
  const n = state.now;
  return period === 'dia' ? C.dayKeyOf(n) : period === 'semana' ? C.weekKeyOf(n) : C.monthKeyOf(n);
}

function viewMovimientos(view) {
  topbar('Historial', 'Consulta, corrige o elimina movimientos');
  const h = ui.hist;
  if (!h.key) h.key = currentKey(h.period);
  const label = h.period === 'dia' ? C.dayLabel(h.key) : h.period === 'semana' ? `Semana ${C.weekLabel(h.key)}` : C.monthLabel(h.key);
  const isCurrent = h.key >= currentKey(h.period);
  let list = C.movementsInPeriod(data, h.period, h.key);
  const expenses = list.filter((m) => m.type === 'expense');
  const spent = expenses.reduce((a, m) => a + m.amount, 0);
  const impulsive = expenses.filter((m) => m.kind === 'impulsivo').reduce((a, m) => a + m.amount, 0);
  const income = list.filter((m) => m.type === 'allowance' || m.type === 'income').reduce((a, m) => a + m.amount, 0);
  const filters = { todo: 'Todo', gastos: 'Gastos', ingresos: 'Ingresos', fondos: 'Fondos' };
  if (h.filter === 'gastos') list = expenses;
  if (h.filter === 'ingresos') list = list.filter((m) => m.type === 'allowance' || m.type === 'income');
  if (h.filter === 'fondos') list = list.filter((m) => ['transfer', 'opening', 'adjust'].includes(m.type));

  let html = `<div class="stack">
    <div class="seg" role="radiogroup" aria-label="Periodo">${['dia', 'semana', 'mes'].map((p) => `<label class="chip"><input type="radio" name="period" value="${p}" ${p === h.period ? 'checked' : ''}><span>${{ dia: 'Día', semana: 'Semana', mes: 'Mes' }[p]}</span></label>`).join('')}</div>
    <div class="period"><button type="button" class="icon-btn" id="prev" aria-label="Periodo anterior">${icon('chev-l')}</button><strong>${esc(label)}</strong><button type="button" class="icon-btn" id="next" aria-label="Periodo siguiente" ${isCurrent ? 'disabled' : ''}>${icon('chev-r')}</button></div>
    <div class="kpis"><div class="kpi"><p class="k">Gastado</p><p class="v num">${money(spent)}</p><p class="s">${expenses.length} ${expenses.length === 1 ? 'gasto' : 'gastos'}</p></div>
      <div class="kpi"><p class="k">Impulsivo</p><p class="v num">${money(impulsive)}</p><p class="s">${spent ? Math.round((impulsive / spent) * 100) : 0} % del gasto</p></div></div>
    ${income ? `<p class="small muted">Ingresos en este periodo: <strong class="num">${money(income)}</strong></p>` : ''}
    <div class="seg" role="radiogroup" aria-label="Tipo de movimiento">${Object.entries(filters).map(([k, v]) => `<label class="chip"><input type="radio" name="filter" value="${k}" ${k === h.filter ? 'checked' : ''}><span>${v}</span></label>`).join('')}</div>`;

  if (!list.length) {
    html += `<div class="card empty">${icon('list')}<h3>Sin movimientos</h3><p class="small">No hay ${h.filter === 'todo' ? 'movimientos' : 'movimientos de este tipo'} en este periodo.</p>${isCurrent && h.filter !== 'ingresos' ? `<button type="button" class="btn primary" id="empty-add">${icon('plus')}Añadir gasto</button>` : ''}</div>`;
  } else {
    const groups = {};
    for (const m of list) (groups[C.dayKeyOf(m.date)] ||= []).push(m);
    for (const [day, items] of Object.entries(groups)) {
      const dSpent = items.filter((m) => m.type === 'expense').reduce((a, m) => a + m.amount, 0);
      html += `<div><div class="day-head"><span>${C.dayLabel(day)}</span><span class="num">${dSpent ? '−' + money(dSpent) : ''}</span></div><ul class="list">${items.map((m) => mvRow(m, false)).join('')}</ul></div>`;
    }
  }
  html += '</div>';
  view.innerHTML = html;
  $$('input[name="period"]', view).forEach((r) => (r.onchange = () => { h.period = r.value; h.key = currentKey(r.value); render(); }));
  $$('input[name="filter"]', view).forEach((r) => (r.onchange = () => { h.filter = r.value; render(); }));
  $('#prev', view).onclick = () => { h.key = shiftPeriod(h.period, h.key, -1); render(); };
  $('#next', view).onclick = () => { if (!isCurrent) { h.key = shiftPeriod(h.period, h.key, 1); render(); } };
  $('#empty-add', view) && ($('#empty-add', view).onclick = () => openExpenseSheet());
}

/* ================= Ahorro ================= */

function savingsWeeklyPoints() {
  const keys = Object.keys(state.weeks).sort();
  return keys.map((k) => {
    const d = C.parseLocal(k);
    return { label: `Semana ${C.weekLabel(k)}`, short: `${d.getDate()}/${d.getMonth() + 1}`, value: state.weeks[k].closing.ahorro };
  });
}

function viewAhorro(view) {
  topbar('Ahorro y fondos', 'Separado del dinero para gastar');
  const t = state.totals;
  const sav = state.balances.ahorro;
  const goal = data.settings.savingsGoal;
  const pct = Math.min(100, (sav / goal) * 100);
  const w = state.weeks[state.currentWeek];
  const pts = savingsWeeklyPoints();
  const savMoves = C.sortMovements(data.movements)
    .reverse()
    .filter((m) => (m.type === 'allowance' && (m.alloc.ahorro || m.extra?.ahorro)) || (m.type === 'income' && m.split.ahorro) || (m.type === 'transfer' && (m.from === 'ahorro' || m.to === 'ahorro')) || ((m.type === 'opening' || m.type === 'adjust') && m.account === 'ahorro'))
    .slice(0, 12);

  let html = `<div class="stack">
    <section class="card hero"><p class="label">Ahorro líquido</p><p class="big num">${money(sav)}</p>
      <div class="between small mt8"><span>Meta: ${money(goal)}</span><strong>${Math.round(pct)} %</strong></div>
      <div class="bar mt4" role="progressbar" aria-label="Progreso de la meta de ahorro" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}"><span style="width:${pct}%;background:var(--good)"></span></div>
      <p class="small muted mt8">${sav >= goal ? '¡Meta alcanzada! Puedes fijar una nueva en Presupuesto y mesada.' : `Te faltan ${money(goal - sav)}. Tus inversiones en bolsa no cuentan para esta meta.`}</p>
    </section>
    <div class="kpis"><div class="kpi"><p class="k">Ahorrado esta semana</p><p class="v num">${money(w.savingsNet)}</p><p class="s">${w.savingsMet ? '✓ Objetivo cumplido' : `Objetivo ${money(w.savingsTarget)}`}</p></div>
      <div class="kpi"><p class="k">Inversiones (bolsa)</p><p class="v num">${money(state.balances.inversion)}</p><p class="s">Aparte del ahorro</p></div></div>

    <section class="card"><h2>De dónde sale tu ahorro</h2><div class="kv mt12">
      <div class="r"><span>Saldo inicial</span><strong>${money(t.openingSavings)}</strong></div>
      <div class="r"><span>Aportaciones semanales</span><strong>${money(t.weeklyContrib, { sign: true })}</strong></div>
      <div class="r"><span>Dinero extra al ahorro</span><strong>${money(t.extraToSavings, { sign: true })}</strong></div>
      <div class="r"><span>Transferencias (reservas y sobrantes)</span><strong>${money(t.transfersToSavings, { sign: true })}</strong></div>
      <div class="r"><span>Retiros</span><strong>${t.withdrawals ? '−' + money(t.withdrawals) : money(0)}</strong></div>
      ${t.adjustments ? `<div class="r"><span>Ajustes</span><strong>${money(t.adjustments, { sign: true })}</strong></div>` : ''}
      <div class="r total"><span>Total</span><strong>${money(sav)}</strong></div></div>
      <div class="inline mt12"><button type="button" class="btn secondary sm" id="edit-open">Editar saldo inicial</button><button type="button" class="btn secondary sm" id="withdraw">Retirar</button></div>
    </section>

    <section class="card"><h2>Evolución del ahorro</h2><p class="small muted mt4">Saldo al final de cada semana.</p>
      <div class="mt12">${pts.length >= 2 ? lineChart({ points: pts.slice(-12), goal, goalLabel: `Meta ${money(goal)}`, title: 'Evolución semanal del ahorro' }) : '<p class="small muted">El gráfico aparecerá cuando tengas al menos dos semanas registradas.</p>'}</div></section>

    <section class="section"><div class="head"><h2>Otros fondos</h2></div><div class="stack">
      ${fundCard('fondoSalidas', 'Para una salida más costosa. Se alimenta con lo que no gastas en salidas.', [['Usar en salidas', 'use-fondo'], ['Añadir', 'add-fondo']])}
      ${fundCard('objetivos', 'Parte del dinero extra que recibes. No aumenta tu presupuesto semanal.', [['Pasar a un presupuesto', 'use-obj'], ['Pasar al ahorro', 'obj-sav']])}
      ${fundCard('inversion', 'Dinero invertido en bolsa. No es dinero para gastar ni parte de la meta de ahorro.', [['Actualizar valor', 'inv-val'], ['Aportar', 'inv-add']])}
    </div></section>

    <section class="section"><div class="head"><h2>Movimientos del ahorro</h2></div>
      ${savMoves.length ? `<ul class="list">${savMoves.map(mvRow).join('')}</ul>` : `<div class="card empty">${icon('piggy')}<h3>Aún no hay aportes</h3><p class="small">Cuando registres tu mesada, ${money(data.settings.plan.ahorro)} irán directo aquí.</p></div>`}
    </section></div>`;
  view.innerHTML = html;
  $('#edit-open', view).onclick = () => openOpeningSheet('ahorro');
  $('#withdraw', view).onclick = () => openTransferSheet({ from: 'ahorro' });
  $('#use-fondo', view).onclick = () => openTransferSheet({ from: 'fondoSalidas', to: 'salidas', note: 'Salida especial' });
  $('#add-fondo', view).onclick = () => openTransferSheet({ from: 'salidas', to: 'fondoSalidas' });
  $('#use-obj', view).onclick = () => openTransferSheet({ from: 'objetivos', to: 'personal' });
  $('#obj-sav', view).onclick = () => openTransferSheet({ from: 'objetivos', to: 'ahorro' });
  $('#inv-add', view).onclick = () => openTransferSheet({ to: 'inversion' });
  $('#inv-val', view).onclick = openInvestmentValueSheet;
}

function fundCard(acc, desc, actions) {
  return `<article class="card"><div class="between"><h3>${C.ACCOUNT_NAMES[acc]}</h3><strong class="num" style="font-size:1.125rem">${money(state.balances[acc])}</strong></div>
    <p class="small muted mt4">${desc}</p><div class="inline mt8">${actions.map(([l, id]) => `<button type="button" class="btn secondary sm" id="${id}">${l}</button>`).join('')}</div></article>`;
}

// Cambio controlado del saldo inicial: requiere motivo, confirmación y queda en el registro de cambios.
function openOpeningSheet(account = 'ahorro') {
  const existing = data.movements.find((m) => m.type === 'opening' && m.account === account);
  const accs = ['ahorro', 'inversion', 'fondoSalidas', 'objetivos'];
  openSheet({
    title: 'Saldo inicial',
    body: `<form id="op-form" class="stack" novalidate>
      <p class="small muted">Es el dinero que ya tenías antes de usar la app. Cambiarlo modifica el saldo total de esa cuenta; el cambio queda registrado.</p>
      <div class="field"><label for="f-acc">Cuenta</label><select id="f-acc" name="acc">${accs.map((a) => `<option value="${a}" ${a === account ? 'selected' : ''}>${C.ACCOUNT_NAMES[a]}</option>`).join('')}</select></div>
      ${amountField({ label: 'Saldo inicial', value: existing ? C.centsToInput(existing.amount) || '0' : '0' })}
      <div class="field"><label for="f-why">Motivo del cambio</label><input id="f-why" name="why" maxlength="80" placeholder="Ej.: Conté mal mis ahorros"><p class="err" id="e-why"></p></div>
      ${data.log.filter((l) => l.kind === 'opening').length ? `<details class="more"><summary>Cambios anteriores</summary><ul class="small muted">${data.log.filter((l) => l.kind === 'opening').map((l) => `<li>${C.dayLabel(C.dayKeyOf(l.date))}: ${esc(l.text)}</li>`).join('')}</ul></details>` : ''}
    </form>`,
    foot: '<button type="submit" form="op-form" class="btn primary block">Guardar saldo inicial</button>',
    onMount: (dlg) => {
      const f = $('#op-form', dlg);
      f.elements.acc.onchange = () => { dlg.close(); openOpeningSheet(f.elements.acc.value); };
      f.onsubmit = async (e) => {
        e.preventDefault();
        const amount = f.elements.amount.value.trim() === '' ? 0 : readCents(f, 'amount');
        const why = f.elements.why.value.trim();
        setErr(f, 'amount', amount == null ? 'Escribe un importe válido (sin signo negativo).' : '');
        setErr(f, 'why', why ? '' : 'Explica brevemente el motivo.');
        if (amount == null || !why) return;
        const old = existing ? existing.amount : 0;
        if (old === amount) return dlg.close();
        const newBal = state.balances[account] - old + amount;
        const r = await confirmDialog({ title: 'Confirmar cambio', body: `<div class="kv"><div class="r"><span>Saldo inicial</span><strong>${money(old)} → ${money(amount)}</strong></div><div class="r"><span>${C.ACCOUNT_NAMES[account]} quedará en</span><strong>${money(newBal)}</strong></div></div>`, confirmText: 'Confirmar cambio' });
        if (r !== 'ok') return;
        dlg.close();
        commit((d) => {
          const ex = d.movements.find((m) => m.type === 'opening' && m.account === account);
          if (ex) ex.amount = amount;
          else {
            const first = C.sortMovements(d.movements)[0];
            const date = first && first.date < `${state.currentWeek}T00:00` ? `${C.weekKeyOf(first.date)}T00:00` : `${state.currentWeek}T00:00`;
            d.movements.push({ id: uid(), type: 'opening', date, account, amount, note: 'Saldo inicial', createdAt: 0 });
          }
          d.log.push({ kind: 'opening', date: nowISO(), text: `${C.ACCOUNT_NAMES[account]}: ${money(old)} → ${money(amount)} (${why})` });
        }, 'Saldo inicial actualizado');
      };
    },
  });
}

function openInvestmentValueSheet() {
  const cur = state.balances.inversion;
  openSheet({
    title: 'Actualizar valor de inversiones',
    body: `<form id="iv-form" class="stack" novalidate>
      <p class="small muted">Si tus inversiones subieron o bajaron en bolsa, escribe su valor actual. Se registra como ajuste (no es gasto ni ingreso).</p>
      ${amountField({ label: 'Valor actual', value: C.centsToInput(cur) })}
    </form>`,
    foot: '<button type="submit" form="iv-form" class="btn primary block">Guardar valor</button>',
    onMount: (dlg) => {
      const f = $('#iv-form', dlg);
      f.onsubmit = (e) => {
        e.preventDefault();
        const v = readCents(f, 'amount');
        if (v == null) return setErr(f, 'amount', 'Escribe un importe válido.');
        const delta = v - cur;
        if (!delta) return dlg.close();
        dlg.close();
        commit((d) => d.movements.push({ id: uid(), type: 'adjust', date: nowISO(), account: 'inversion', delta, note: delta > 0 ? 'Revalorización en bolsa' : 'Pérdida de valor en bolsa', createdAt: Date.now() }), `Inversiones: ${money(v)}`);
      };
    },
  });
}

/* ================= Cierre semanal ================= */

function defaultCloseWeek() {
  const cur = state.currentWeek;
  if (C.dayIndex(state.now) === 6) return cur;
  const past = C.activeWeeks(state).filter((w) => w.weekKey < cur && !w.closed);
  return past.length ? past[past.length - 1].weekKey : C.addDays(cur, -7);
}

function viewCierre(view, params) {
  const wk = params.get('w') || ui.closeWeek || defaultCloseWeek();
  ui.closeWeek = wk;
  const w = state.weeks[wk];
  topbar('Cierre semanal', `Semana ${C.weekLabel(wk)}`, '#/mas');
  const weekOptions = Object.keys(state.weeks).sort().reverse().slice(0, 26);
  let html = `<div class="stack"><div class="field"><label for="f-week">Semana</label><select id="f-week">${weekOptions
    .map((k) => `<option value="${k}" ${k === wk ? 'selected' : ''}>${C.weekLabel(k)}${state.weeks[k].closed ? ' · cerrada' : k === state.currentWeek ? ' · actual' : ''}</option>`)
    .join('')}</select></div>`;
  if (!w || !w.hasActivity) {
    html += `<div class="card empty">${icon('calendar')}<h3>Sin datos esa semana</h3><p class="small">No hay mesada ni gastos registrados.</p></div></div>`;
    view.innerHTML = html;
    $('#f-week', view).onchange = (e) => { ui.closeWeek = e.target.value; location.hash = `#/cierre?w=${e.target.value}`; };
    return;
  }
  const prev = C.activeWeeks(state).filter((x) => x.weekKey < wk).slice(-4);
  const avgPrev = prev.length ? Math.round(prev.reduce((a, x) => a + x.spent, 0) / prev.length) : null;
  const cats = Object.entries(w.byCategory).sort((a, b) => b[1] - a[1]);

  html += `<section class="card"><div class="between"><h2>Resumen</h2>${w.closed ? '<span class="pill ok">' + icon('check') + 'Cerrada</span>' : w.isCurrent ? '<span class="pill neutral">En curso</span>' : '<span class="pill warn">Sin cerrar</span>'}</div>
    <div class="kv mt12">
      <div class="r"><span>Mesada recibida</span><strong>${money(w.allowance)}</strong></div>
      ${w.extraIncome ? `<div class="r"><span>Ingresos extra</span><strong>${money(w.extraIncome)}</strong></div>` : ''}
      <div class="r"><span>Presupuesto para gastar</span><strong>${money(w.totalBudget)}</strong></div>
      <div class="r"><span>Total gastado</span><strong>${money(w.spent)}</strong></div>
      <div class="r"><span>Compras impulsivas</span><strong>${money(w.impulsive)} (${w.impulsiveCount})</strong></div>
      <div class="r"><span>Presupuesto que sobró</span><strong>${money(w.leftover)}</strong></div>
      <div class="r"><span>Ahorro conseguido</span><strong>${money(w.savingsNet)}</strong></div>
      <div class="r"><span>Categoría con más gasto</span><strong>${w.topCategory ? esc(catName(w.topCategory.categoryId)) : '—'}</strong></div>
    </div>
    <div class="mt12">${w.savingsMet ? notice('good', 'check', `<p><strong>Cumpliste tu objetivo de ahorro</strong> de ${money(w.savingsTarget)}.</p>`) : notice('warn', 'alert', `<p><strong>No llegaste al objetivo de ahorro</strong>: faltaron ${money(w.savingsTarget - w.savingsNet)}.</p>`)}</div>
    <div class="mt8">${w.withinBudget ? notice('good', 'check', '<p>Te mantuviste dentro del presupuesto.</p>') : notice('danger', 'alert', '<p>Te pasaste del presupuesto en al menos una categoría.</p>')}</div>
  </section>`;

  html += `<section class="card"><h2>Planificado vs. real</h2><div class="stack mt12">${C.BUCKETS.map(
    (b) => `<div><div class="between small"><span><i class="dot" style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${BUCKET_COLOR[b]};margin-right:6px"></i>${C.ACCOUNT_NAMES[b]}</span><strong class="num">${money(w.byBucket[b])} / ${money(w.budget[b])}</strong></div>
      <div class="bar thin mt4 ${levelClass(w.usage[b])}"><span style="width:${Math.min(100, w.usage[b])}%"></span></div></div>`,
  ).join('')}</div>
    <p class="small muted mt12">Planificado: ${money(w.planned)} · Impulsivo: ${money(w.impulsive)}</p></section>`;

  html += `<section class="card"><h2>Gastos por categoría</h2><div class="mt12">${cats.length ? hBars(cats.map(([id, v]) => ({ label: catName(id), value: v })), { total: w.spent }) : '<p class="small muted">Sin gastos esta semana.</p>'}</div></section>`;

  html += `<section class="card"><h2>Comparación con semanas anteriores</h2>${
    prev.length
      ? `<div class="mt12">${barChart({ items: [...prev, w].map((x) => ({ label: `Semana ${C.weekLabel(x.weekKey)}`, short: x.weekKey === wk ? 'Esta' : `${C.parseLocal(x.weekKey).getDate()}/${C.parseLocal(x.weekKey).getMonth() + 1}`, value: x.spent, color: x.weekKey === wk ? 'var(--primary)' : 'var(--text-2)' })), title: 'Gasto de esta semana frente a las anteriores' })}</div>
         <p class="small mt8">${w.spent === avgPrev ? 'Igual que tu promedio' : `${money(Math.abs(w.spent - avgPrev))} ${w.spent > avgPrev ? 'más' : 'menos'} que tu promedio`} de las últimas ${prev.length} ${prev.length === 1 ? 'semana' : 'semanas'} (${money(avgPrev)}).</p>`
      : '<p class="small muted mt8">Es tu primera semana registrada: aún no hay con qué comparar.</p>'
  }</section>`;

  if (!w.closed) {
    const prop = C.closeProposal(state, wk);
    const can = C.canCloseWeek(wk, state.now);
    const destName = { keep: 'Pasar a la próxima semana', ahorro: 'Enviar al ahorro', fondoSalidas: 'Guardar en el fondo para salidas' };
    html += `<section class="card"><h2>¿Qué hacer con lo que sobró?</h2><p class="small muted mt4">Nada se pierde: lo que no muevas pasa a la próxima semana en la misma categoría.</p>
      <form id="close-form" class="stack mt12">${C.BUCKETS.map((b) =>
        prop[b].amount > 0
          ? `<div class="field"><label for="f-c-${b}">${C.ACCOUNT_NAMES[b]}: sobran <strong class="num">${money(prop[b].amount)}</strong></label>
            <select id="f-c-${b}" name="${b}">${C.CLOSE_OPTIONS[b].map((o) => `<option value="${o}" ${o === prop[b].dest ? 'selected' : ''}>${destName[o]}</option>`).join('')}</select></div>`
          : `<p class="small muted">${C.ACCOUNT_NAMES[b]}: no sobró nada${state.weeks[wk].closing[b] < 0 ? ` (déficit de ${money(-state.weeks[wk].closing[b])}, se descontará la próxima semana)` : ''}.</p>`,
      ).join('')}
      ${can ? '<button type="submit" class="btn primary block">Cerrar semana y generar informe</button>' : notice('info', 'clock', '<p class="small">Podrás cerrar esta semana el domingo.</p>')}
      </form></section>`;
  } else {
    const closeMoves = data.movements.filter((m) => m.closeOf === wk);
    html += `<section class="card"><h2>Decisiones del cierre</h2><div class="kv mt12">${closeMoves.length ? closeMoves.map((m) => `<div class="r"><span>${C.SHORT_NAMES[m.from]} → ${C.SHORT_NAMES[m.to]}</span><strong>${money(m.amount)}</strong></div>`).join('') : '<p class="small muted">Todo lo sobrante pasó a la siguiente semana.</p>'}</div></section>`;
  }

  html += `<section class="card"><div class="between"><h2>Informe para ChatGPT</h2></div>
    <p class="small muted mt4">${w.closed ? 'Cópialo y pégalo en tu conversación.' : 'Vista previa: el informe definitivo se genera al cerrar la semana.'}</p>
    <textarea class="report mt8" id="report" readonly aria-label="Informe semanal">${esc(C.buildWeeklyReport(state, data, wk))}</textarea>
    <button type="button" class="btn ${w.closed ? 'primary' : 'secondary'} block mt8" id="copy">${icon('copy')}Copiar informe</button>
    ${w.closed ? '<button type="button" class="btn danger-ghost block mt8" id="reopen">Reabrir semana</button>' : ''}
  </section></div>`;

  view.innerHTML = html;
  $('#f-week', view).onchange = (e) => { ui.closeWeek = e.target.value; location.hash = `#/cierre?w=${e.target.value}`; };
  $('#copy', view).onclick = () => copyText($('#report', view).value);
  const form = $('#close-form', view);
  if (form) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const prop = C.closeProposal(state, wk);
      for (const b of C.BUCKETS) if (form.elements[b]) prop[b].dest = form.elements[b].value;
      const moves = C.buildCloseTransfers(wk, prop, uid);
      const summary = moves.length ? moves.map((m) => `<div class="r"><span>${C.SHORT_NAMES[m.from]} → ${C.SHORT_NAMES[m.to]}</span><strong>${money(m.amount)}</strong></div>`).join('') : '<p>Todo lo que sobró pasará a la próxima semana.</p>';
      if ((await confirmDialog({ title: '¿Cerrar la semana?', body: `<div class="kv">${summary}</div><p class="small muted mt8">Los datos de la semana se conservan. Podrás reabrirla si te equivocas.</p>`, confirmText: 'Cerrar semana' })) !== 'ok') return;
      commit((d) => {
        d.movements.push(...moves);
        d.closes[wk] = { closedAt: nowISO() };
      }, 'Semana cerrada. Ya puedes copiar el informe.');
      setTimeout(() => $('#report')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
    };
  }
  const re = $('#reopen', view);
  if (re) {
    re.onclick = async () => {
      if ((await confirmDialog({ title: '¿Reabrir la semana?', body: '<p>Se desharán las transferencias del cierre (el dinero vuelve a sus categorías). Los gastos no se tocan.</p>', confirmText: 'Reabrir' })) !== 'ok') return;
      commit((d) => {
        d.movements = d.movements.filter((m) => m.closeOf !== wk);
        delete d.closes[wk];
      }, 'Semana reabierta');
    };
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Informe copiado');
  } catch {
    const ta = $('#report');
    ta.removeAttribute('readonly');
    ta.select();
    const ok = document.execCommand && document.execCommand('copy');
    ta.setAttribute('readonly', '');
    toast(ok ? 'Informe copiado' : 'Selecciona el texto y cópialo manualmente');
  }
}

/* ================= Estadísticas ================= */

function viewEstadisticas(view) {
  topbar('Estadísticas', 'Tus hábitos con datos reales', '#/mas');
  const s = C.statsSummary(state, data);
  const weeks = C.activeWeeks(state);
  if (!weeks.length) {
    view.innerHTML = `<div class="card empty">${icon('chart')}<h3>Aún no hay datos</h3><p class="small">Registra tu mesada y algunos gastos; aquí verás tus promedios y tendencias.</p></div>`;
    return;
  }
  const last = weeks.slice(-8);
  const planSpend = data.settings.plan.salidas + data.settings.plan.personal + data.settings.plan.reserva;
  const short = (k) => { const d = C.parseLocal(k); return `${d.getDate()}/${d.getMonth() + 1}`; };

  let cats = s.topCategories;
  if (ui.statsRange === 'mes') {
    const mk = C.monthKeyOf(state.now);
    const agg = {};
    data.movements.filter((m) => m.type === 'expense' && C.monthKeyOf(m.date) === mk).forEach((m) => (agg[m.categoryId] = (agg[m.categoryId] || 0) + m.amount));
    cats = Object.entries(agg).map(([id, amount]) => ({ id, name: catName(id), amount })).sort((a, b) => b.amount - a.amount);
  }
  const catTotal = cats.reduce((a, c) => a + c.amount, 0);
  const complete = weeks.filter((w) => w.isComplete);
  const avgByBucket = Object.fromEntries(C.BUCKETS.map((b) => [b, complete.length ? Math.round(complete.reduce((a, w) => a + w.byBucket[b], 0) / complete.length) : 0]));
  const pts = savingsWeeklyPoints();

  let html = `<div class="stack">
    <div class="kpis four">
      <div class="kpi"><p class="k">Gasto semanal medio</p><p class="v num">${money(s.avgWeeklySpend)}</p><p class="s">Plan: ${money(planSpend)}</p></div>
      <div class="kpi"><p class="k">Semanas en presupuesto</p><p class="v num">${s.compliance == null ? '—' : Math.round(s.compliance) + ' %'}</p><p class="s">${s.completeCount} ${s.completeCount === 1 ? 'semana completa' : 'semanas completas'}</p></div>
      <div class="kpi"><p class="k">Semanas con ahorro cumplido</p><p class="v num">${s.savingsMetPct == null ? '—' : Math.round(s.savingsMetPct) + ' %'}</p><p class="s">Objetivo ${money(data.settings.weeklySavingsTarget)}</p></div>
      <div class="kpi"><p class="k">Impulsivo (total)</p><p class="v num">${money(s.totalImpulsive)}</p><p class="s">${Math.round(s.impulsiveShare)} % del gasto</p></div>
    </div>
    <div class="grid-2-lg stack">
    <section class="card"><h2>Gasto por semana</h2><p class="small muted mt4">Barras en rojo: semanas por encima del plan de ${money(planSpend)}.</p>
      <div class="mt12">${barChart({ items: last.map((w) => ({ label: `Semana ${C.weekLabel(w.weekKey)}`, short: short(w.weekKey), value: w.spent })), limit: planSpend, limitLabel: 'Plan', title: 'Gasto por semana' })}</div></section>
    <section class="card"><h2>Compras impulsivas por semana</h2>
      <div class="mt12">${barChart({ items: last.map((w) => ({ label: `Semana ${C.weekLabel(w.weekKey)} (${w.impulsiveCount} compras)`, short: short(w.weekKey), value: w.impulsive })), color: 'var(--warn)', title: 'Compras impulsivas por semana' })}</div>
      <p class="small muted mt8">${last.map((w) => w.impulsiveCount).reduce((a, b) => a + b, 0)} compras impulsivas en las últimas ${last.length} semanas.</p></section>
    </div>
    <section class="card"><h2>¿En qué gastas más?</h2>
      <div class="seg mt8">${[['todo', 'Siempre'], ['mes', 'Este mes']].map(([k, v]) => `<label class="chip"><input type="radio" name="range" value="${k}" ${k === ui.statsRange ? 'checked' : ''}><span>${v}</span></label>`).join('')}</div>
      <div class="mt12">${cats.length ? hBars(cats.map((c) => ({ label: c.name, value: c.amount })), { total: catTotal }) : '<p class="small muted">Sin gastos en este periodo.</p>'}</div></section>
    <section class="card"><h2>Plan vs. real (promedio semanal)</h2>
      ${complete.length ? `<div class="kv mt12">${C.BUCKETS.map((b) => `<div class="r"><span>${C.ACCOUNT_NAMES[b]}</span><strong>${money(avgByBucket[b])} / ${money(data.settings.plan[b])} ${avgByBucket[b] > data.settings.plan[b] ? '<span style="color:var(--danger)">▲</span>' : '<span style="color:var(--good)">✓</span>'}</strong></div>`).join('')}</div><p class="small muted mt8">Real / planificado. ▲ = gastas más de lo planificado.</p>` : '<p class="small muted mt8">Disponible cuando completes tu primera semana.</p>'}</section>
    <section class="card"><h2>Evolución del ahorro</h2><div class="mt12">${pts.length >= 2 ? lineChart({ points: pts.slice(-12), goal: data.settings.savingsGoal, goalLabel: 'Meta', title: 'Evolución del ahorro' }) : '<p class="small muted">Necesitas al menos dos semanas.</p>'}</div></section>
    <section class="card"><h2>Dinero acumulado sin usar</h2><div class="kv mt12">
      <div class="r"><span>Fondo para salidas</span><strong>${money(s.unusedFunds.fondoSalidas)}</strong></div>
      <div class="r"><span>Objetivos personales</span><strong>${money(s.unusedFunds.objetivos)}</strong></div>
      <div class="r"><span>Reserva de imprevistos</span><strong>${money(s.unusedFunds.reserva)}</strong></div>
      <div class="r"><span>Sobrantes en salidas y personal</span><strong>${money(s.unusedFunds.sobrantes)}</strong></div>
      ${s.avoidedCount ? `<div class="r total"><span>Evitado tras esperar 24 h</span><strong>${money(s.avoided)}</strong></div>` : ''}
    </div></section>
  </div>`;
  view.innerHTML = html;
  $$('input[name="range"]', view).forEach((r) => (r.onchange = () => { ui.statsRange = r.value; render(); }));
}

/* ================= Más / configuración ================= */

function viewMas(view) {
  topbar('Más');
  const pendingWishes = data.wishes.filter((x) => x.status === 'pendiente').length;
  const item = (href, ic, label, sub = '') => `<li><a href="${href}">${icon(ic)}<span class="grow">${label}${sub ? `<br><small class="muted">${sub}</small>` : ''}</span>${icon('chev-r', 'chev')}</a></li>`;
  const btn = (id, ic, label, sub = '') => `<li><button type="button" id="${id}">${icon(ic)}<span class="grow">${label}${sub ? `<br><small class="muted">${sub}</small>` : ''}</span>${icon('chev-r', 'chev')}</button></li>`;
  view.innerHTML = `<div class="stack">
    <ul class="menu">
      ${item('#/cierre', 'check', 'Cierre semanal', 'Resumen e informe para ChatGPT')}
      ${item('#/estadisticas', 'chart', 'Estadísticas', 'Promedios, categorías y tendencias')}
      ${item('#/deseos', 'clock', 'Esperar 24 h', pendingWishes ? `${pendingWishes} pendiente${pendingWishes === 1 ? '' : 's'}` : 'Piensa antes de comprar')}
    </ul>
    <ul class="menu">
      ${btn('m-allow', 'calendar', 'Registrar mesada', 'Cualquier importe')}
      ${btn('m-income', 'gift', 'Ingreso extra', 'Regalos, trabajos, ventas…')}
      ${btn('m-transfer', 'swap', 'Mover dinero entre fondos', 'No cuenta como gasto ni ingreso')}
    </ul>
    <ul class="menu">
      ${item('#/ajustes', 'sliders', 'Presupuesto y mesada', `${money(data.settings.allowance)} · ${money(data.settings.plan.ahorro)} ahorro`)}
      ${item('#/categorias', 'tag', 'Categorías')}
      ${item('#/datos', 'save', 'Copia de seguridad', 'Exportar o importar tus datos')}
      ${item('#/instalar', 'phone', 'Instalar en el celular')}
    </ul></div>`;
  $('#m-allow', view).onclick = () => openAllowanceSheet({});
  $('#m-income', view).onclick = () => openIncomeSheet({});
  $('#m-transfer', view).onclick = () => openTransferSheet({});
}

function viewAjustes(view) {
  topbar('Presupuesto y mesada', 'Los cambios aplican a las próximas mesadas', '#/mas');
  const s = data.settings;
  view.innerHTML = `<form id="set-form" class="stack" novalidate>
    <section class="card stack">
      ${amountField({ name: 'allowance', label: 'Mesada habitual (cada lunes)', value: C.centsToInput(s.allowance), hint: 'Si un lunes recibes otra cantidad, la registras al momento; no hace falta cambiar esto.' })}
      <h3>Reparto semanal</h3>
      ${moneyRow('p-ahorro', 'Ahorro', s.plan.ahorro)}${moneyRow('p-salidas', 'Salidas (novia y amigos)', s.plan.salidas)}${moneyRow('p-personal', 'Personal, snacks y antojos', s.plan.personal)}${moneyRow('p-reserva', 'Reserva imprevistos', s.plan.reserva)}
      <div class="split-total" id="plan-total"></div>
    </section>
    <section class="card stack">
      <div class="field"><label for="f-pct">Dinero extra: % sugerido para el ahorro</label><input id="f-pct" name="pct" inputmode="numeric" value="${s.extraSplit.ahorro}"><p class="hint">El resto se sugiere para objetivos personales. Siempre puedes cambiarlo antes de confirmar.</p></div>
      ${amountField({ name: 'goal', label: 'Meta de ahorro líquido', value: C.centsToInput(s.savingsGoal) })}
      ${amountField({ name: 'target', label: 'Objetivo de ahorro semanal', value: C.centsToInput(s.weeklySavingsTarget) })}
    </section>
    <p class="err" id="set-err" role="alert"></p>
    <button type="submit" class="btn primary block">Guardar</button>
    <p class="small muted">Las mesadas ya registradas conservan su reparto original.</p>
  </form>`;
  const f = $('#set-form', view);
  const read = () => ({
    allowance: readCents(f, 'allowance'),
    plan: { ahorro: readCents(f, 'p-ahorro'), salidas: readCents(f, 'p-salidas'), personal: readCents(f, 'p-personal'), reserva: readCents(f, 'p-reserva') },
    extraSplit: { ahorro: Number(f.elements.pct.value), objetivos: 100 - Number(f.elements.pct.value) },
    savingsGoal: readCents(f, 'goal'),
    weeklySavingsTarget: readCents(f, 'target'),
  });
  const upd = () => {
    const r = read();
    const tot = Object.values(r.plan).reduce((a, b) => a + (b || 0), 0);
    const el = $('#plan-total', view);
    const okk = r.allowance && tot === r.allowance;
    el.className = 'split-total ' + (okk ? 'good' : 'bad');
    el.innerHTML = `<span>Reparto</span><span class="num">${money(tot)} de ${money(r.allowance || 0)} ${okk ? '✓' : ''}</span>`;
  };
  f.addEventListener('input', upd);
  upd();
  f.onsubmit = (e) => {
    e.preventDefault();
    const r = read();
    if ([r.allowance, r.savingsGoal, r.weeklySavingsTarget, ...Object.values(r.plan)].some((v) => v == null)) return ($('#set-err', view).textContent = 'Hay importes no válidos.');
    const errs = C.validateSettings(r);
    if (errs.length) return ($('#set-err', view).textContent = errs[0]);
    $('#set-err', view).textContent = '';
    commit((d) => {
      d.settings = r;
      d.log.push({ kind: 'settings', date: nowISO(), text: `Plan: mesada ${money(r.allowance)}` });
    }, 'Configuración guardada');
  };
}

function viewCategorias(view) {
  topbar('Categorías', 'Asigna cada categoría a un presupuesto', '#/mas');
  const used = new Set(data.movements.filter((m) => m.type === 'expense').map((m) => m.categoryId));
  const sel = (c) => `<select name="bucket" aria-label="Presupuesto de ${esc(c.name)}">${C.BUCKETS.map((b) => `<option value="${b}" ${b === c.bucket ? 'selected' : ''}>${C.SHORT_NAMES[b]}</option>`).join('')}</select>`;
  view.innerHTML = `<div class="stack">
    <p class="small muted">Cambiar el presupuesto de una categoría afecta a los gastos nuevos; los gastos anteriores se quedan donde se registraron.</p>
    ${data.categories.map((c) => `<form class="card stack" data-cat="${esc(c.id)}" style="gap:10px;${c.archived ? 'opacity:.6' : ''}">
      <div class="field"><label for="cn-${esc(c.id)}">Nombre</label><input id="cn-${esc(c.id)}" name="name" maxlength="40" value="${esc(c.name)}"></div>
      <div class="cat-row"><div class="field"><span class="label" style="font-size:.875rem;font-weight:600">Presupuesto</span>${sel(c)}</div>
      <div class="inline" style="justify-content:flex-end"><button class="btn secondary sm" type="submit">Guardar</button>
      <button class="btn ${c.archived ? 'ghost' : 'danger-ghost'} sm" type="button" data-arch>${c.archived ? 'Reactivar' : used.has(c.id) ? 'Ocultar' : 'Eliminar'}</button></div></div>
    </form>`).join('')}
    <form class="card stack" id="new-cat" style="gap:10px"><h3>Nueva categoría</h3>
      <div class="field"><label for="nc-name">Nombre</label><input id="nc-name" name="name" maxlength="40" placeholder="Ej.: Regalos"></div>
      <div class="field"><label for="nc-b">Presupuesto</label><select id="nc-b" name="bucket">${C.BUCKETS.map((b) => `<option value="${b}">${C.ACCOUNT_NAMES[b]}</option>`).join('')}</select></div>
      <p class="err" id="nc-err"></p><button class="btn primary" type="submit">Añadir categoría</button></form></div>`;
  $$('[data-cat]', view).forEach((form) => {
    const id = form.dataset.cat;
    form.onsubmit = (e) => {
      e.preventDefault();
      const name = form.elements.name.value.trim();
      if (!name) return toast('El nombre no puede quedar vacío.');
      commit((d) => Object.assign(d.categories.find((c) => c.id === id), { name, bucket: form.elements.bucket.value }), 'Categoría guardada');
    };
    $('[data-arch]', form).onclick = () => {
      const c = data.categories.find((x) => x.id === id);
      if (!c.archived && !used.has(id)) return commit((d) => (d.categories = d.categories.filter((x) => x.id !== id)), 'Categoría eliminada');
      commit((d) => (d.categories.find((x) => x.id === id).archived = !c.archived), c.archived ? 'Categoría reactivada' : 'Categoría oculta (sus gastos se conservan)');
    };
  });
  $('#new-cat', view).onsubmit = (e) => {
    e.preventDefault();
    const f = e.target;
    const name = f.elements.name.value.trim();
    if (!name) return ($('#nc-err', view).textContent = 'Escribe un nombre.');
    if (data.categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) return ($('#nc-err', view).textContent = 'Ya existe una categoría con ese nombre.');
    commit((d) => d.categories.push({ id: uid(), name, bucket: f.elements.bucket.value, archived: false }), 'Categoría añadida');
  };
}

function viewDatos(view) {
  topbar('Copia de seguridad', 'Tus datos viven solo en este dispositivo', '#/mas');
  const n = data.movements.length;
  view.innerHTML = `<div class="stack">
    ${notice('info', 'phone', `<p class="small">Los datos se guardan en el almacenamiento interno del navegador de este dispositivo (no en internet). Si borras los datos del navegador o desinstalas la app, se pierden: <strong>exporta una copia cada semana</strong> (por ejemplo, al hacer el cierre) y guárdala en iCloud, Google Drive o envíatela por correo.</p>`)}
    <section class="card stack"><h2>Exportar</h2><p class="small muted">${n} movimientos, ${data.categories.length} categorías y ${data.wishes.length} deseos.</p>
      <button type="button" class="btn primary block" id="exp">${icon('save')}Descargar copia (.json)</button>
      <button type="button" class="btn secondary block" id="exp-copy">${icon('copy')}Copiar datos al portapapeles</button></section>
    <section class="card stack"><h2>Importar</h2><p class="small muted">Sustituye <strong>todos</strong> los datos actuales por los de la copia. Úsalo para pasar tus datos a otro dispositivo o recuperarlos.</p>
      <label class="btn secondary block" for="imp">${icon('in')}Elegir archivo de copia</label><input type="file" id="imp" accept="application/json,.json" class="sr"></section>
    <p class="small muted" id="persist"></p></div>`;
  $('#exp', view).onclick = async () => {
    const json = exportJSON(data);
    const name = backupFileName();
    const file = new File([json], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Copia de Mesada' }); return toast('Copia lista'); } catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('Copia descargada');
  };
  $('#exp-copy', view).onclick = async () => {
    try { await navigator.clipboard.writeText(exportJSON(data)); toast('Datos copiados'); } catch { toast('No se pudo copiar'); }
  };
  $('#imp', view).onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const imported = parseImport(await file.text());
      const r = await confirmDialog({ title: '¿Reemplazar tus datos?', body: `<p>La copia tiene ${imported.movements.length} movimientos. Tus ${data.movements.length} movimientos actuales se sustituirán.</p>`, confirmText: 'Reemplazar', danger: true });
      if (r !== 'ok') return;
      commit((d) => { Object.keys(d).forEach((k) => delete d[k]); Object.assign(d, imported); }, 'Datos importados');
    } catch (err) {
      toast(err.message);
    }
  };
  if (navigator.storage?.persisted) {
    navigator.storage.persisted().then((p) => ($('#persist', view) && ($('#persist', view).textContent = p ? 'Almacenamiento persistente activado: el navegador no borrará tus datos por falta de espacio.' : 'Consejo: instala la app en tu pantalla de inicio para que el sistema conserve mejor tus datos.')));
  }
}

function viewInstalar(view) {
  topbar('Instalar en el celular', '', '#/mas');
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  view.innerHTML = `<div class="stack">
    ${standalone ? notice('good', 'check', '<p>Ya estás usando la app instalada.</p>') : ''}
    ${ui.installEvent ? `<button type="button" class="btn primary block" id="install">${icon('phone')}Instalar app</button>` : ''}
    <section class="card stack"><h2>iPhone (Safari)</h2><ol class="small" style="margin:0;padding-left:20px;display:grid;gap:6px">
      <li>Abre la dirección de la app en <strong>Safari</strong>.</li><li>Toca el botón <strong>Compartir</strong> (cuadro con flecha hacia arriba).</li>
      <li>Elige <strong>Añadir a pantalla de inicio</strong> y luego <strong>Añadir</strong>.</li><li>Abre “Mesada” desde el icono: funciona sin internet.</li></ol></section>
    <section class="card stack"><h2>Android (Chrome)</h2><ol class="small" style="margin:0;padding-left:20px;display:grid;gap:6px">
      <li>Abre la dirección en <strong>Chrome</strong>.</li><li>Toca el menú <strong>⋮</strong> y elige <strong>Instalar aplicación</strong> (o “Añadir a pantalla de inicio”).</li></ol></section>
    ${notice('warn', 'alert', '<p class="small">Los datos de la app instalada son independientes de los del navegador y de otros dispositivos. Usa <a href="#/datos">Copia de seguridad</a> para pasarlos.</p>')}
  </div>`;
  $('#install', view) && ($('#install', view).onclick = async () => { ui.installEvent.prompt(); await ui.installEvent.userChoice; ui.installEvent = null; render(); });
}

/* ================= Arranque ================= */

function init() {
  try {
    data = loadData();
  } catch (e) {
    document.body.innerHTML = `<main style="padding:24px"><h1>No se pudieron cargar tus datos</h1><p>${esc(e.message)}</p></main>`;
    return;
  }
  recompute();
  render();
  window.addEventListener('hashchange', () => { closeSheet(); render(); window.scrollTo(0, 0); $('#view').focus({ preventScroll: true }); });
  $('#tab-add').onclick = () => openExpenseSheet();
  // Acceso directo "Añadir gasto" desde el icono de la app.
  if (route().params.get('add') === '1') {
    history.replaceState(null, '', '#/inicio');
    if (data.setupDone) openExpenseSheet();
  }
  // Si cambia el día (p. ej. la app queda abierta de domingo a lunes), recalcula.
  let lastMinute = nowISO();
  const refresh = () => {
    const n = nowISO();
    if (n.slice(0, 13) !== lastMinute.slice(0, 13) || C.dayKeyOf(n) !== C.dayKeyOf(lastMinute)) {
      lastMinute = n;
      recompute();
      if (!$('#sheet').open && !$('#confirm').open) render();
    }
  };
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && refresh());
  setInterval(refresh, 60000);
  window.addEventListener('storage', (e) => { if (e.key && e.key.startsWith('mesada.')) { data = loadData(); recompute(); render(); } });
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); ui.installEvent = e; });
  if (data.setupDone) requestPersistence();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
}

init();

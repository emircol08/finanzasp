// Pruebas de los cálculos financieros. Se ejecutan con `./tests/run.sh` (motor JavaScriptCore de macOS)
// o abriendo tests/index.html en el navegador.
import * as C from '../js/core.js';

const results = [];
function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (e) {
    results.push({ name, ok: false, error: e && e.message ? e.message : String(e) });
  }
}
function eq(actual, expected, msg = '') {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg} esperado ${b}, obtenido ${a}`);
}
function ok(v, msg = 'se esperaba verdadero') {
  if (!v) throw new Error(msg);
}

let n = 0;
const id = () => 'm' + ++n;
const RD = (x) => Math.round(x * 100);

function freshData() {
  const d = C.defaultData();
  d.setupDone = true;
  return d;
}
function allowance(d, date, amount) {
  const s = C.suggestAllowanceSplit(RD(amount), d.settings);
  const m = { id: id(), type: 'allowance', date, amount: RD(amount), alloc: s.alloc, extra: s.extra, createdAt: n };
  eq(C.validateMovement(m, d), [], 'mesada válida:');
  d.movements.push(m);
  return m;
}
function expense(d, date, amount, categoryId, kind = 'planificado') {
  const cat = d.categories.find((c) => c.id === categoryId);
  const m = { id: id(), type: 'expense', date, amount: RD(amount), categoryId, bucket: cat.bucket, method: 'efectivo', kind, description: '', createdAt: n };
  eq(C.validateMovement(m, d), [], 'gasto válido:');
  d.movements.push(m);
  return m;
}
function transfer(d, date, from, to, amount, extra = {}) {
  const m = { id: id(), type: 'transfer', date, from, to, amount: RD(amount), note: '', createdAt: n, ...extra };
  d.movements.push(m);
  return m;
}

// Lunes 12 de octubre de 2026.
const MON = '2026-10-12';

/* ---------- Dinero ---------- */
test('parseAmount acepta formatos comunes y rechaza negativos', () => {
  eq(C.parseAmount('1000'), 100000);
  eq(C.parseAmount('1,500'), 150000);
  eq(C.parseAmount('1,500.50'), 150050);
  eq(C.parseAmount('RD$ 600'), 60000);
  eq(C.parseAmount('99,5'), 9950);
  eq(C.parseAmount('0.1'), 10);
  eq(C.parseAmount('-50'), null);
  eq(C.parseAmount('abc'), null);
  eq(C.parseAmount(''), null);
  eq(C.parseAmount('12.345'), null);
});

test('formatRD usa RD$ y separadores', () => {
  eq(C.formatRD(100000), 'RD$1,000');
  eq(C.formatRD(150050), 'RD$1,500.50');
  eq(C.formatRD(-2500), '−RD$25');
  eq(C.formatRD(0), 'RD$0');
});

/* ---------- Fechas ---------- */
test('las semanas empiezan el lunes y terminan el domingo (hora local)', () => {
  eq(C.weekKeyOf('2026-10-12T00:00'), MON);
  eq(C.weekKeyOf('2026-10-18T23:59'), MON);
  eq(C.weekKeyOf('2026-10-19T00:00'), '2026-10-19');
  eq(C.weekKeyOf('2026-10-11T23:59'), '2026-10-05');
  eq(C.weekKeyOf('2027-01-01T10:00'), '2026-12-28'); // cruza de año
});

test('días hasta la próxima mesada', () => {
  eq(C.daysUntilNextMonday('2026-10-12T09:00'), 7);
  eq(C.daysUntilNextMonday('2026-10-13T09:00'), 6);
  eq(C.daysUntilNextMonday('2026-10-18T09:00'), 1);
});

/* ---------- Reparto de la mesada ---------- */
test('mesada de RD$1,000 se reparte 300/400/200/100', () => {
  const d = freshData();
  const s = C.suggestAllowanceSplit(RD(1000), d.settings);
  eq(s.alloc, { ahorro: RD(300), salidas: RD(400), personal: RD(200), reserva: RD(100) });
  eq(C.sumValues(s.extra), 0);
});

test('mesada de RD$1,500: presupuesto igual y RD$500 extra -> 350 ahorro / 150 objetivos', () => {
  const d = freshData();
  const s = C.suggestAllowanceSplit(RD(1500), d.settings);
  eq(s.alloc, { ahorro: RD(300), salidas: RD(400), personal: RD(200), reserva: RD(100) });
  eq(s.extra, { ahorro: RD(350), objetivos: RD(150), fondoSalidas: 0, inversion: 0 });
});

test('mesada menor (RD$800) recalcula proporcionalmente y cuadra al centavo', () => {
  const d = freshData();
  const s = C.suggestAllowanceSplit(RD(800), d.settings);
  eq(s.alloc, { salidas: RD(320), personal: RD(160), reserva: RD(80), ahorro: RD(240) });
  const odd = C.suggestAllowanceSplit(RD(333.33), d.settings);
  eq(C.sumValues(odd.alloc), RD(333.33));
});

test('el reparto debe cuadrar con el importe', () => {
  const d = freshData();
  const m = { id: 'x', type: 'allowance', date: `${MON}T08:00`, amount: RD(1000), alloc: { ahorro: RD(300), salidas: RD(400), personal: RD(200), reserva: RD(50) }, extra: {} };
  ok(C.validateMovement(m, d).length === 1, 'debería quejarse de RD$50 sin repartir');
});

test('70/30 de un ingreso extraordinario y redondeo exacto', () => {
  const d = freshData();
  eq(C.suggestIncomeSplit(RD(1000), d.settings), { ahorro: RD(700), objetivos: RD(300), fondoSalidas: 0, inversion: 0 });
  const odd = C.suggestIncomeSplit(1, d.settings);
  eq(odd.ahorro + odd.objetivos, 1);
});

/* ---------- Saldos ---------- */
test('el ahorro se separa al registrar la mesada y no cuenta como disponible', () => {
  const d = freshData();
  allowance(d, `${MON}T08:00`, 1000);
  const st = C.computeState(d, `${MON}T09:00`);
  eq(st.spendable, RD(700));
  eq(st.balances.ahorro, RD(300));
  eq(st.weeks[MON].savingsNet, RD(300));
  ok(st.weeks[MON].savingsMet);
});

test('el ejemplo de Wendy’s: RD$600 el martes deja RD$100 para el resto de la semana', () => {
  const d = freshData();
  allowance(d, `${MON}T08:00`, 1000);
  const st0 = C.computeState(d, '2026-10-13T13:00');
  const p = C.previewExpense(st0, { amount: RD(600), bucket: 'personal', date: '2026-10-13T13:00' });
  ok(p.exceedsBucket, 'supera la categoría personal (RD$200)');
  ok(!p.exceedsTotal, 'no supera el total (RD$700)');
  eq(p.totalAfter, RD(100));
  eq(p.daysLeft, 6);
  eq(p.perDayAfter, Math.floor(RD(100) / 6));
  const w = C.expenseWarnings(p, null);
  ok(w.some((x) => x.text.includes('Personal')), 'avisa de la categoría');
  ok(w.some((x) => x.text.includes('por día')), 'avisa del impacto diario');
  // La advertencia no modifica nada:
  eq(C.computeState(d, '2026-10-13T13:00').spendable, RD(700));
});

test('advertencia cuando el gasto supera el saldo disponible', () => {
  const d = freshData();
  allowance(d, `${MON}T08:00`, 1000);
  const st = C.computeState(d, `${MON}T10:00`);
  const p = C.previewExpense(st, { amount: RD(800), bucket: 'salidas', date: `${MON}T10:00` });
  ok(p.exceedsTotal);
  ok(C.expenseWarnings(p, null)[0].level === 'danger');
});

test('niveles de alerta 75/90/100 %', () => {
  eq(C.usageLevel(C.usagePct(RD(150), RD(200))), 75);
  eq(C.usageLevel(C.usagePct(RD(180), RD(200))), 90);
  eq(C.usageLevel(C.usagePct(RD(200), RD(200))), 100);
  eq(C.usageLevel(C.usagePct(RD(100), RD(200))), 0);
  eq(C.usagePct(RD(10), 0), 100);
});

test('editar y borrar gastos recalcula todo', () => {
  const d = freshData();
  allowance(d, `${MON}T08:00`, 1000);
  const e = expense(d, `${MON}T12:00`, 250, 'novia');
  let st = C.computeState(d, `${MON}T13:00`);
  eq(st.balances.salidas, RD(150));
  e.amount = RD(100);
  st = C.computeState(d, `${MON}T13:00`);
  eq(st.balances.salidas, RD(300));
  eq(st.weeks[MON].spent, RD(100));
  d.movements = d.movements.filter((m) => m.id !== e.id);
  st = C.computeState(d, `${MON}T13:00`);
  eq(st.balances.salidas, RD(400));
  eq(st.weeks[MON].spent, 0);
});

test('detecta un gasto duplicado accidental', () => {
  const d = freshData();
  allowance(d, `${MON}T08:00`, 1000);
  const e = expense(d, `${MON}T12:00`, 85, 'snacks');
  const cand = { ...e, id: 'nuevo', date: `${MON}T12:04` };
  ok(C.findDuplicate(d.movements, cand), 'debería detectarlo');
  ok(!C.findDuplicate(d.movements, { ...cand, date: `${MON}T15:00` }), 'horas distintas no es duplicado');
  ok(!C.findDuplicate(d.movements, e), 'no se compara consigo mismo');
});

test('no se aceptan importes negativos ni cero', () => {
  const d = freshData();
  const bad = { id: 'x', type: 'expense', date: `${MON}T10:00`, amount: -500, categoryId: 'snacks', bucket: 'personal', method: 'efectivo', kind: 'planificado' };
  ok(C.validateMovement(bad, d).length > 0);
  ok(C.validateMovement({ ...bad, amount: 0 }, d).length > 0);
});

test('los sobrantes pasan a la semana siguiente sin perderse', () => {
  const d = freshData();
  allowance(d, `${MON}T08:00`, 1000);
  expense(d, `${MON}T12:00`, 100, 'snacks');
  allowance(d, '2026-10-19T08:00', 1000);
  const st = C.computeState(d, '2026-10-19T09:00');
  const w2 = st.weeks['2026-10-19'];
  eq(w2.opening.personal, RD(100));
  eq(w2.budget.personal, RD(300));
  eq(st.spendable, RD(700 + 600));
  eq(st.balances.ahorro, RD(600));
});

test('cierre: reserva al ahorro, salidas al fondo, sin duplicar dinero', () => {
  const d = freshData();
  allowance(d, `${MON}T08:00`, 1000);
  expense(d, `${MON}T20:00`, 150, 'amigos');
  let st = C.computeState(d, '2026-10-18T18:00');
  const totalBefore = Object.values(st.balances).reduce((a, b) => a + b, 0);
  const prop = C.closeProposal(st, MON);
  eq(prop.reserva, { amount: RD(100), dest: 'ahorro' });
  eq(prop.salidas, { amount: RD(250), dest: 'fondoSalidas' });
  eq(prop.personal, { amount: RD(200), dest: 'keep' });
  d.movements.push(...C.buildCloseTransfers(MON, prop, id));
  d.closes[MON] = { closedAt: '2026-10-18T18:00' };
  st = C.computeState(d, '2026-10-18T18:05');
  const totalAfter = Object.values(st.balances).reduce((a, b) => a + b, 0);
  eq(totalAfter, totalBefore, 'las transferencias no crean ni destruyen dinero');
  eq(st.balances.ahorro, RD(400));
  eq(st.balances.fondoSalidas, RD(250));
  eq(st.spendable, RD(200));
  const w = st.weeks[MON];
  eq(w.spent, RD(150), 'las transferencias no son gasto');
  eq(w.savingsNet, RD(400));
  eq(w.leftover, RD(550), 'el sobrante del resumen no cambia por cerrar');
  ok(w.closed);
});

test('solo se puede cerrar la semana actual en domingo', () => {
  ok(!C.canCloseWeek(MON, '2026-10-17T20:00'));
  ok(C.canCloseWeek(MON, '2026-10-18T20:00'));
  ok(C.canCloseWeek(MON, '2026-10-20T20:00'));
});

test('ingreso extra no aumenta el presupuesto de gasto', () => {
  const d = freshData();
  allowance(d, `${MON}T08:00`, 1000);
  d.movements.push({ id: id(), type: 'income', date: `${MON}T15:00`, amount: RD(1000), source: 'Regalo', split: C.suggestIncomeSplit(RD(1000), d.settings) });
  const st = C.computeState(d, `${MON}T16:00`);
  eq(st.spendable, RD(700));
  eq(st.weeks[MON].totalBudget, RD(700));
  eq(st.balances.ahorro, RD(1000));
  eq(st.balances.objetivos, RD(300));
  eq(st.weeks[MON].extraIncome, RD(1000));
});

test('mesada de RD$1,500 se refleja en saldos sin subir límites', () => {
  const d = freshData();
  allowance(d, `${MON}T08:00`, 1500);
  const st = C.computeState(d, `${MON}T09:00`);
  eq(st.weeks[MON].totalBudget, RD(700));
  eq(st.balances.ahorro, RD(650));
  eq(st.balances.objetivos, RD(150));
  eq(st.weeks[MON].allowance, RD(1500));
});

test('las transferencias entre cuentas propias no son ingresos ni gastos', () => {
  const d = freshData();
  allowance(d, `${MON}T08:00`, 1000);
  transfer(d, `${MON}T10:00`, 'ahorro', 'salidas', 100);
  const st = C.computeState(d, `${MON}T11:00`);
  const w = st.weeks[MON];
  eq(w.allowance, RD(1000));
  eq(w.extraIncome, 0);
  eq(w.spent, 0);
  eq(w.savingsNet, RD(200));
  ok(!w.savingsMet, 'retirar ahorro hace que no se cumpla el objetivo');
  eq(w.budget.salidas, RD(500));
  eq(st.totals.withdrawals, RD(100));
});

test('una transferencia no puede dejar el origen en negativo', () => {
  const d = freshData();
  allowance(d, `${MON}T08:00`, 1000);
  const st = C.computeState(d, `${MON}T09:00`);
  ok(C.validateTransfer(st, { from: 'reserva', to: 'ahorro', amount: RD(150) }).length > 0);
  eq(C.validateTransfer(st, { from: 'reserva', to: 'ahorro', amount: RD(100) }), []);
});

test('los RD$8,500 invertidos no cuentan como disponible ni como ahorro líquido', () => {
  const d = freshData();
  d.movements.push({ id: id(), type: 'opening', date: `${MON}T00:00`, account: 'inversion', amount: RD(8500) });
  d.movements.push({ id: id(), type: 'opening', date: `${MON}T00:00`, account: 'ahorro', amount: RD(1200) });
  allowance(d, `${MON}T08:00`, 1000);
  const st = C.computeState(d, `${MON}T09:00`);
  eq(st.spendable, RD(700));
  eq(st.balances.ahorro, RD(1500));
  eq(st.balances.inversion, RD(8500));
  eq(st.weeks[MON].savingsNet, RD(300), 'el saldo inicial no es aportación semanal');
  eq(st.totals.openingSavings, RD(1200));
});

test('cuadre del ahorro: inicial + aportes + extra + transferencias − retiros + ajustes = saldo', () => {
  const d = freshData();
  d.movements.push({ id: id(), type: 'opening', date: `${MON}T00:00`, account: 'ahorro', amount: RD(500) });
  allowance(d, `${MON}T08:00`, 1500);
  transfer(d, '2026-10-18T23:59', 'reserva', 'ahorro', 100, { closeOf: MON });
  transfer(d, '2026-10-20T10:00', 'ahorro', 'salidas', 50);
  d.movements.push({ id: id(), type: 'adjust', date: '2026-10-21T10:00', account: 'ahorro', delta: RD(-20), note: 'Corrección' });
  const st = C.computeState(d, '2026-10-21T11:00');
  const t = st.totals;
  eq(t.openingSavings + t.weeklyContrib + t.extraToSavings + t.transfersToSavings - t.withdrawals + t.adjustments, st.balances.ahorro);
  eq(st.balances.ahorro, RD(500 + 300 + 350 + 100 - 50 - 20));
});

test('cumplimiento del presupuesto por semana', () => {
  const d = freshData();
  allowance(d, `${MON}T08:00`, 1000);
  expense(d, `${MON}T12:00`, 250, 'snacks'); // personal 200 -> se pasa
  allowance(d, '2026-10-19T08:00', 1000);
  expense(d, '2026-10-19T12:00', 50, 'snacks');
  const st = C.computeState(d, '2026-10-26T09:00');
  ok(!st.weeks[MON].withinBudget);
  ok(st.weeks['2026-10-19'].withinBudget);
  const s = C.statsSummary(st, d);
  eq(s.compliance, 50);
  eq(s.avgWeeklySpend, RD(150));
});

test('el gasto que deja una categoría en negativo se arrastra como déficit', () => {
  const d = freshData();
  allowance(d, `${MON}T08:00`, 1000);
  expense(d, `${MON}T12:00`, 250, 'snacks');
  allowance(d, '2026-10-19T08:00', 1000);
  const st = C.computeState(d, '2026-10-19T09:00');
  eq(st.weeks['2026-10-19'].budget.personal, RD(150));
});

test('compras impulsivas y planificadas se separan', () => {
  const d = freshData();
  allowance(d, `${MON}T08:00`, 1000);
  expense(d, `${MON}T12:00`, 100, 'snacks', 'impulsivo');
  expense(d, `${MON}T13:00`, 300, 'novia', 'planificado');
  const w = C.computeState(d, `${MON}T14:00`).weeks[MON];
  eq(w.impulsive, RD(100));
  eq(w.impulsiveCount, 1);
  eq(w.planned, RD(300));
});

test('semanas sin movimientos intermedias no rompen los saldos', () => {
  const d = freshData();
  allowance(d, `${MON}T08:00`, 1000);
  allowance(d, '2026-11-02T08:00', 1000);
  const st = C.computeState(d, '2026-11-02T09:00');
  ok(st.weeks['2026-10-19'] && st.weeks['2026-10-26']);
  eq(st.spendable, RD(1400));
  ok(!st.weeks['2026-10-19'].hasActivity);
});

test('la regla de las 24 h', () => {
  const w = { status: 'pendiente', createdAt: '2026-10-13T20:00' };
  ok(!C.wishIsReady(w, '2026-10-14T19:59'));
  ok(C.wishIsReady(w, '2026-10-14T20:00'));
  eq(C.hoursUntilReady(w, '2026-10-14T10:00'), 10);
});

test('el informe semanal incluye importes exactos y no inventa datos', () => {
  const d = freshData();
  allowance(d, `${MON}T08:00`, 1000);
  expense(d, '2026-10-13T13:00', 600, 'comida', 'impulsivo');
  const st = C.computeState(d, '2026-10-18T20:00');
  const r = C.buildWeeklyReport(st, d, MON);
  ok(r.includes('Mesada recibida: RD$1,000'));
  ok(r.includes('Total gastado: RD$600'));
  ok(r.includes('Comida fuera de casa: RD$600'));
  ok(r.includes('Me pasé en Gastos personales por RD$400'));
  ok(r.includes('No hay semanas anteriores'));
  ok(r.includes('CUMPLIDO'));
});

test('la configuración del plan debe sumar la mesada', () => {
  const d = freshData();
  eq(C.validateSettings(d.settings), []);
  const s = JSON.parse(JSON.stringify(d.settings));
  s.allowance = RD(1200);
  ok(C.validateSettings(s).length === 1);
});

test('importar rechaza copias con IDs duplicados', () => {
  const d = freshData();
  allowance(d, `${MON}T08:00`, 1000);
  eq(C.validateImport(d), null);
  d.movements.push({ ...d.movements[0] });
  ok(C.validateImport(d));
});

export function summary() {
  const failed = results.filter((r) => !r.ok);
  return { results, failed, passed: results.length - failed.length, total: results.length };
}

// Lógica financiera pura (sin DOM). Todos los importes son enteros en centavos de RD$.
// Las fechas se guardan como hora local "AAAA-MM-DDTHH:mm" (sin zona horaria):
// las semanas van de lunes a domingo según el reloj local del dispositivo.

export const SCHEMA_VERSION = 1;

export const BUCKETS = ['salidas', 'personal', 'reserva'];
export const FUNDS = ['ahorro', 'fondoSalidas', 'objetivos', 'inversion'];
export const ACCOUNTS = [...BUCKETS, ...FUNDS];

export const ACCOUNT_NAMES = {
  salidas: 'Salidas (novia y amigos)',
  personal: 'Gastos personales',
  reserva: 'Reserva imprevistos',
  ahorro: 'Ahorro líquido',
  fondoSalidas: 'Fondo para salidas',
  objetivos: 'Objetivos personales',
  inversion: 'Inversiones (bolsa)',
};

export const SHORT_NAMES = {
  salidas: 'Salidas',
  personal: 'Personal',
  reserva: 'Reserva',
  ahorro: 'Ahorro',
  fondoSalidas: 'Fondo salidas',
  objetivos: 'Objetivos',
  inversion: 'Inversiones',
};

export const METHODS = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia' };
export const KINDS = { planificado: 'Planificado', impulsivo: 'Impulsivo' };

// Destinos posibles del dinero extra (mesada por encima de lo habitual o ingresos extraordinarios).
export const EXTRA_DESTS = ['ahorro', 'objetivos', 'fondoSalidas', 'inversion'];

export const WISH_WAIT_HOURS = 24;
export const DUPLICATE_WINDOW_MIN = 10;

export function defaultData() {
  return {
    version: SCHEMA_VERSION,
    setupDone: false,
    settings: {
      allowance: 100000,
      plan: { ahorro: 30000, salidas: 40000, personal: 20000, reserva: 10000 },
      extraSplit: { ahorro: 70, objetivos: 30 },
      savingsGoal: 500000,
      weeklySavingsTarget: 30000,
    },
    categories: [
      { id: 'novia', name: 'Salidas con mi novia', bucket: 'salidas', archived: false },
      { id: 'amigos', name: 'Salidas con amigos', bucket: 'salidas', archived: false },
      { id: 'snacks', name: 'Snacks y bebidas', bucket: 'personal', archived: false },
      { id: 'comida', name: 'Comida fuera de casa', bucket: 'personal', archived: false },
      { id: 'compras', name: 'Compras personales', bucket: 'personal', archived: false },
      { id: 'otros', name: 'Otros', bucket: 'reserva', archived: false },
    ],
    movements: [],
    wishes: [],
    closes: {},
    log: [],
  };
}

/* ---------------- Dinero ---------------- */

// Convierte texto escrito por el usuario a centavos. Devuelve null si no es válido.
// Acepta "1500", "1,500", "1500.50", "1,500.50", "RD$ 600", "99,5".
export function parseAmount(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? Math.round(input * 100) : null;
  if (input == null) return null;
  let s = String(input).trim().replace(/RD\$|\$|DOP|\s/gi, '');
  if (!s) return null;
  if (s.startsWith('-')) return null;
  const hasDot = s.includes('.');
  const hasComma = s.includes(',');
  if (hasDot && hasComma) {
    s = s.replace(/,/g, '');
  } else if (hasComma) {
    // "1,500" o "12,000,000" -> miles; "99,5" o "99,50" -> decimal
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  }
  if (!/^\d+(\.\d{0,2})?$/.test(s) && !/^\d*\.\d{1,2}$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export function formatRD(cents, { sign = false } = {}) {
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100);
  const dec = abs % 100;
  const wholeStr = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = 'RD$' + wholeStr + (dec ? '.' + String(dec).padStart(2, '0') : '');
  if (neg) return '−' + body;
  if (sign && cents > 0) return '+' + body;
  return body;
}

export function centsToInput(cents) {
  if (!cents) return '';
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

const sum = (obj) => Object.values(obj || {}).reduce((a, b) => a + (b || 0), 0);
export { sum as sumValues };

/* ---------------- Fechas ---------------- */

const pad = (n) => String(n).padStart(2, '0');

export function ymd(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function toLocalISO(d) {
  return `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function parseLocal(s) {
  const [date, time = '00:00'] = String(s).split('T');
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(y, m - 1, d, hh || 0, mm || 0);
}

export function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  return ymd(new Date(y, m - 1, d + n));
}

// Lunes (AAAA-MM-DD) de la semana a la que pertenece una fecha local.
export function weekKeyOf(s) {
  const d = parseLocal(s.length === 10 ? s + 'T12:00' : s);
  const dow = (d.getDay() + 6) % 7; // lunes = 0 ... domingo = 6
  return ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow));
}

export const weekEnd = (weekKey) => addDays(weekKey, 6);
export const monthKeyOf = (s) => s.slice(0, 7);
export const dayKeyOf = (s) => s.slice(0, 10);

export function dayIndex(s) {
  return (parseLocal(s).getDay() + 6) % 7;
}

// Días que quedan en la semana contando hoy (lunes = 7, domingo = 1).
export const daysLeftInWeek = (nowISO) => 7 - dayIndex(nowISO);
// Días hasta el próximo lunes (domingo = 1, lunes = 7).
export const daysUntilNextMonday = (nowISO) => 7 - dayIndex(nowISO);

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MONTHS_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

export function weekLabel(weekKey) {
  const a = parseLocal(weekKey);
  const b = parseLocal(weekEnd(weekKey));
  if (a.getMonth() === b.getMonth()) return `${a.getDate()}–${b.getDate()} ${MONTHS[b.getMonth()]}`;
  return `${a.getDate()} ${MONTHS[a.getMonth()]} – ${b.getDate()} ${MONTHS[b.getMonth()]}`;
}

export function weekLabelLong(weekKey) {
  const a = parseLocal(weekKey);
  const b = parseLocal(weekEnd(weekKey));
  return `del lunes ${a.getDate()} de ${MONTHS_LONG[a.getMonth()]} al domingo ${b.getDate()} de ${MONTHS_LONG[b.getMonth()]} de ${b.getFullYear()}`;
}

export function dayLabel(dayKey) {
  const d = parseLocal(dayKey);
  return `${DAYS[(d.getDay() + 6) % 7]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function monthLabel(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  return `${MONTHS_LONG[m - 1]} ${y}`;
}

export const timeOf = (s) => s.slice(11, 16);

/* ---------------- Sugerencias de reparto ---------------- */

export function splitExtra(amount, extraSplit) {
  const ahorroPct = extraSplit?.ahorro ?? 70;
  const ahorro = Math.round((amount * ahorroPct) / 100);
  return { ahorro, objetivos: amount - ahorro, fondoSalidas: 0, inversion: 0 };
}

// Reparto sugerido de una mesada. Si es mayor que la habitual, el presupuesto no crece:
// se aplica el plan habitual y el excedente se reparte como dinero extra (70/30 por defecto).
// Si es menor, el plan se reduce proporcionalmente (el resto de centavos va al ahorro).
export function suggestAllowanceSplit(amount, settings) {
  const base = settings.allowance;
  const plan = settings.plan;
  if (amount >= base) {
    return {
      alloc: { ahorro: plan.ahorro, salidas: plan.salidas, personal: plan.personal, reserva: plan.reserva },
      extra: splitExtra(amount - base, settings.extraSplit),
    };
  }
  const alloc = {};
  let used = 0;
  for (const k of ['salidas', 'personal', 'reserva', 'ahorro']) {
    alloc[k] = base > 0 ? Math.floor((amount * plan[k]) / base) : 0;
    used += alloc[k];
  }
  alloc.ahorro += amount - used;
  return { alloc, extra: { ahorro: 0, objetivos: 0, fondoSalidas: 0, inversion: 0 } };
}

export function suggestIncomeSplit(amount, settings) {
  return splitExtra(amount, settings.extraSplit);
}

/* ---------------- Validación ---------------- */

const isCents = (v) => Number.isInteger(v) && v >= 0;

export function validateMovement(m, data) {
  const errors = [];
  if (!m || !m.type) return ['Movimiento sin tipo.'];
  if (!m.date || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(m.date)) errors.push('Fecha u hora no válida.');
  if (m.type !== 'adjust' && m.type !== 'opening') {
    if (!Number.isInteger(m.amount) || m.amount <= 0) errors.push('El importe debe ser mayor que RD$0.');
  }
  switch (m.type) {
    case 'expense': {
      const cat = data.categories.find((c) => c.id === m.categoryId);
      if (!cat) errors.push('Elige una categoría.');
      if (!BUCKETS.includes(m.bucket)) errors.push('La categoría no tiene un presupuesto asignado.');
      if (!METHODS[m.method]) errors.push('Elige un método de pago.');
      if (!KINDS[m.kind]) errors.push('Indica si fue planificado o impulsivo.');
      break;
    }
    case 'allowance': {
      const keys = ['ahorro', 'salidas', 'personal', 'reserva'];
      const ex = EXTRA_DESTS;
      if (!keys.every((k) => isCents(m.alloc?.[k] ?? 0)) || !ex.every((k) => isCents(m.extra?.[k] ?? 0))) {
        errors.push('Los importes del reparto no pueden ser negativos.');
      }
      const total = sum(m.alloc) + sum(m.extra);
      if (total !== m.amount) {
        const diff = m.amount - total;
        errors.push(diff > 0 ? `Falta repartir ${formatRD(diff)}.` : `Has repartido ${formatRD(-diff)} de más.`);
      }
      break;
    }
    case 'income': {
      if (!EXTRA_DESTS.every((k) => isCents(m.split?.[k] ?? 0))) errors.push('Los importes del reparto no pueden ser negativos.');
      const total = sum(m.split);
      if (total !== m.amount) {
        const diff = m.amount - total;
        errors.push(diff > 0 ? `Falta repartir ${formatRD(diff)}.` : `Has repartido ${formatRD(-diff)} de más.`);
      }
      if (!m.source || !String(m.source).trim()) errors.push('Indica el origen del dinero.');
      break;
    }
    case 'transfer':
      if (!ACCOUNTS.includes(m.from) || !ACCOUNTS.includes(m.to)) errors.push('Elige origen y destino.');
      else if (m.from === m.to) errors.push('El origen y el destino deben ser distintos.');
      break;
    case 'opening':
      if (!ACCOUNTS.includes(m.account)) errors.push('Cuenta no válida.');
      if (!isCents(m.amount)) errors.push('El saldo inicial no puede ser negativo.');
      break;
    case 'adjust':
      if (!FUNDS.includes(m.account)) errors.push('Cuenta no válida.');
      if (!Number.isInteger(m.delta) || m.delta === 0) errors.push('El ajuste debe ser distinto de cero.');
      if (!m.note || !String(m.note).trim()) errors.push('Explica el motivo del ajuste.');
      break;
    default:
      errors.push('Tipo de movimiento desconocido.');
  }
  return errors;
}

export function validateSettings(s) {
  const errors = [];
  if (!Number.isInteger(s.allowance) || s.allowance <= 0) errors.push('La mesada habitual debe ser mayor que RD$0.');
  for (const k of ['ahorro', 'salidas', 'personal', 'reserva']) {
    if (!isCents(s.plan[k])) errors.push('Los importes del plan no pueden ser negativos.');
  }
  const planSum = sum(s.plan);
  if (planSum !== s.allowance) {
    errors.push(`El plan suma ${formatRD(planSum)} pero la mesada es ${formatRD(s.allowance)}. Deben coincidir.`);
  }
  const p = s.extraSplit?.ahorro;
  if (!Number.isFinite(p) || p < 0 || p > 100) errors.push('El porcentaje de ahorro del dinero extra debe estar entre 0 y 100.');
  if (!isCents(s.savingsGoal) || s.savingsGoal <= 0) errors.push('La meta de ahorro debe ser mayor que RD$0.');
  if (!isCents(s.weeklySavingsTarget)) errors.push('El objetivo semanal de ahorro no puede ser negativo.');
  return errors;
}

// Posible duplicado: otro gasto con el mismo importe y categoría registrado a pocos minutos.
export function findDuplicate(movements, candidate, windowMin = DUPLICATE_WINDOW_MIN) {
  if (candidate.type !== 'expense') return null;
  const t = parseLocal(candidate.date).getTime();
  return (
    movements.find(
      (m) =>
        m.type === 'expense' &&
        m.id !== candidate.id &&
        m.amount === candidate.amount &&
        m.categoryId === candidate.categoryId &&
        Math.abs(parseLocal(m.date).getTime() - t) <= windowMin * 60000,
    ) || null
  );
}

/* ---------------- Cálculo de saldos ---------------- */

const zeroAccounts = () => Object.fromEntries(ACCOUNTS.map((a) => [a, 0]));
const zeroBuckets = () => Object.fromEntries(BUCKETS.map((b) => [b, 0]));

function emptyWeek(weekKey) {
  return {
    weekKey,
    allowance: 0, // mesada recibida
    allowanceCount: 0,
    extraIncome: 0, // ingresos extraordinarios
    alloc: { ahorro: 0, salidas: 0, personal: 0, reserva: 0 },
    extraToFunds: { ahorro: 0, objetivos: 0, fondoSalidas: 0, inversion: 0 },
    spent: 0,
    byCategory: {},
    byBucket: zeroBuckets(),
    byDay: {},
    impulsive: 0,
    impulsiveCount: 0,
    planned: 0,
    expenseCount: 0,
    savingsIn: 0,
    savingsOut: 0,
    transfersIn: zeroBuckets(),
    transfersOut: zeroBuckets(), // salidas que no son del cierre
    closeOut: zeroBuckets(), // movido en el cierre semanal
    opening: zeroAccounts(),
    closing: zeroAccounts(),
  };
}

export function sortMovements(movements) {
  return [...movements].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt || 0) - (b.createdAt || 0)));
}

// Recalcula TODO a partir del historial de movimientos. Así, editar o borrar un movimiento
// actualiza automáticamente saldos, semanas y estadísticas.
export function computeState(data, nowISO) {
  const movements = sortMovements(data.movements);
  const currentWeek = weekKeyOf(nowISO);
  const balances = zeroAccounts();
  const weeks = {};
  const savingsSeries = [];
  const totals = { openingSavings: 0, weeklyContrib: 0, extraToSavings: 0, transfersToSavings: 0, withdrawals: 0, adjustments: 0 };

  const byWeek = {};
  for (const m of movements) (byWeek[weekKeyOf(m.date)] ||= []).push(m);

  const keys = Object.keys(byWeek).sort();
  const first = keys.length ? (keys[0] < currentWeek ? keys[0] : currentWeek) : currentWeek;
  const last = keys.length && keys[keys.length - 1] > currentWeek ? keys[keys.length - 1] : currentWeek;

  for (let wk = first; wk <= last; wk = addDays(wk, 7)) {
    const w = emptyWeek(wk);
    w.opening = { ...balances };
    for (const m of byWeek[wk] || []) {
      const savingsBefore = balances.ahorro;
      applyMovement(m, w, balances, totals, data);
      if (balances.ahorro !== savingsBefore) savingsSeries.push({ date: m.date, balance: balances.ahorro });
    }
    w.closing = { ...balances };
    finalizeWeek(w, data, wk === currentWeek, wk < currentWeek);
    weeks[wk] = w;
  }

  const spendable = BUCKETS.reduce((a, b) => a + balances[b], 0);
  return { now: nowISO, currentWeek, balances, spendable, weeks, savingsSeries, totals };
}

function applyMovement(m, w, bal, totals) {
  switch (m.type) {
    case 'allowance': {
      w.allowance += m.amount;
      w.allowanceCount += 1;
      for (const k of ['ahorro', 'salidas', 'personal', 'reserva']) {
        const v = m.alloc?.[k] || 0;
        bal[k] += v;
        w.alloc[k] += v;
      }
      for (const k of EXTRA_DESTS) {
        const v = m.extra?.[k] || 0;
        bal[k] += v;
        w.extraToFunds[k] += v;
      }
      w.savingsIn += (m.alloc?.ahorro || 0) + (m.extra?.ahorro || 0);
      totals.weeklyContrib += m.alloc?.ahorro || 0;
      totals.extraToSavings += m.extra?.ahorro || 0;
      break;
    }
    case 'income': {
      w.extraIncome += m.amount;
      for (const k of EXTRA_DESTS) {
        const v = m.split?.[k] || 0;
        bal[k] += v;
        w.extraToFunds[k] += v;
      }
      w.savingsIn += m.split?.ahorro || 0;
      totals.extraToSavings += m.split?.ahorro || 0;
      break;
    }
    case 'expense': {
      bal[m.bucket] -= m.amount;
      w.spent += m.amount;
      w.expenseCount += 1;
      w.byBucket[m.bucket] += m.amount;
      w.byCategory[m.categoryId] = (w.byCategory[m.categoryId] || 0) + m.amount;
      const day = dayKeyOf(m.date);
      w.byDay[day] = (w.byDay[day] || 0) + m.amount;
      if (m.kind === 'impulsivo') {
        w.impulsive += m.amount;
        w.impulsiveCount += 1;
      } else {
        w.planned += m.amount;
      }
      break;
    }
    case 'transfer': {
      bal[m.from] -= m.amount;
      bal[m.to] += m.amount;
      if (BUCKETS.includes(m.from)) {
        if (m.closeOf) w.closeOut[m.from] += m.amount;
        else w.transfersOut[m.from] += m.amount;
      }
      if (BUCKETS.includes(m.to)) w.transfersIn[m.to] += m.amount;
      if (m.to === 'ahorro') {
        w.savingsIn += m.amount;
        totals.transfersToSavings += m.amount;
      }
      if (m.from === 'ahorro') {
        w.savingsOut += m.amount;
        totals.withdrawals += m.amount;
      }
      break;
    }
    case 'opening': {
      bal[m.account] += m.amount;
      if (m.account === 'ahorro') totals.openingSavings += m.amount;
      break;
    }
    case 'adjust': {
      bal[m.account] += m.delta;
      if (m.account === 'ahorro') totals.adjustments += m.delta;
      break;
    }
  }
}

function finalizeWeek(w, data, isCurrent, isPast) {
  w.budget = {};
  w.remaining = {};
  w.usage = {};
  let totalBudget = 0;
  let overBucket = false;
  for (const b of BUCKETS) {
    // Presupuesto real de la semana = lo que arrastra + lo asignado + transferencias (sin contar el cierre).
    const budget = w.opening[b] + w.alloc[b] + w.transfersIn[b] - w.transfersOut[b];
    w.budget[b] = budget;
    w.remaining[b] = budget - w.byBucket[b];
    w.usage[b] = usagePct(w.byBucket[b], budget);
    totalBudget += budget;
    if (w.byBucket[b] > 0 && w.byBucket[b] > budget) overBucket = true;
  }
  w.totalBudget = totalBudget;
  w.leftover = totalBudget - w.spent;
  w.savingsNet = w.savingsIn - w.savingsOut;
  w.savingsTarget = data.settings.weeklySavingsTarget;
  w.savingsMet = w.savingsNet >= w.savingsTarget;
  w.hasActivity = w.allowanceCount > 0 || w.expenseCount > 0 || w.extraIncome > 0;
  w.withinBudget = !overBucket && w.spent <= totalBudget;
  w.isCurrent = isCurrent;
  w.isComplete = isPast;
  w.closed = !!data.closes?.[w.weekKey];
  let top = null;
  for (const [cat, v] of Object.entries(w.byCategory)) if (!top || v > top.amount) top = { categoryId: cat, amount: v };
  w.topCategory = top;
}

export function usagePct(spent, budget) {
  if (spent <= 0) return 0;
  if (budget <= 0) return 100;
  return (spent / budget) * 100;
}

// Nivel de alerta por uso: 0 (<75 %), 75, 90 o 100.
export function usageLevel(pct) {
  if (pct >= 100) return 100;
  if (pct >= 90) return 90;
  if (pct >= 75) return 75;
  return 0;
}

/* ---------------- Ritmo e impacto ---------------- */

// Estado de la semana: compara lo gastado con lo que "tocaba" gastar hasta hoy.
export function weekPace(week, nowISO) {
  const elapsedDays = dayIndex(nowISO) + 1; // incluye hoy
  const daysLeft = 7 - dayIndex(nowISO);
  const available = Math.max(0, week.totalBudget - week.spent);
  const expected = Math.round((week.totalBudget * elapsedDays) / 7);
  const perDay = Math.floor(available / daysLeft);
  let status = 'ok';
  const overBucket = BUCKETS.some((b) => week.byBucket[b] > 0 && week.byBucket[b] > week.budget[b]);
  if (week.spent > week.totalBudget || overBucket) status = 'over';
  else if (week.spent > expected) status = 'warn';
  return { status, expected, perDay, daysLeft, available };
}

// Muestra el impacto de un gasto ANTES de guardarlo. No modifica nada.
// Al editar, pasa un estado calculado sin el gasto original.
export function previewExpense(state, { amount, bucket, date }) {
  const wk = weekKeyOf(date || state.now);
  const week = state.weeks[wk];
  const spendable = state.spendable;
  const bucketBalance = state.balances[bucket];
  const budget = week ? week.budget[bucket] : 0;
  const spentBefore = week ? week.byBucket[bucket] : 0;
  const spentAfter = spentBefore + amount;
  const bucketAfter = bucketBalance - amount;
  const totalAfter = spendable - amount;
  const pctBefore = usagePct(spentBefore, budget);
  const pctAfter = usagePct(spentAfter, budget);
  const daysLeft = wk === state.currentWeek ? daysLeftInWeek(state.now) : 1;
  return {
    bucket,
    budget,
    bucketBefore: bucketBalance,
    bucketAfter,
    totalBefore: spendable,
    totalAfter,
    pctBefore,
    pctAfter,
    levelBefore: usageLevel(pctBefore),
    levelAfter: usageLevel(pctAfter),
    exceedsBucket: amount > bucketBalance,
    exceedsTotal: amount > spendable,
    perDayAfter: totalAfter > 0 ? Math.floor(totalAfter / daysLeft) : 0,
    daysLeft,
    shareOfAvailable: spendable > 0 ? (amount / spendable) * 100 : 100,
  };
}

// Advertencias que se muestran antes de confirmar un gasto. Nunca bloquean ni cambian el presupuesto.
export function expenseWarnings(preview, duplicate, { closedWeek = false } = {}) {
  const w = [];
  if (duplicate) w.push({ level: 'danger', text: `Ya registraste un gasto igual (${formatRD(duplicate.amount)}, misma categoría) a las ${timeOf(duplicate.date)}. ¿Seguro que no está repetido?` });
  if (preview.exceedsTotal) {
    w.push({ level: 'danger', text: `Este gasto supera tu saldo disponible para gastar (${formatRD(preview.totalBefore)}). Quedarías en ${formatRD(preview.totalAfter)}.` });
  } else if (preview.exceedsBucket) {
    w.push({ level: 'warn', text: `Supera lo que queda en ${SHORT_NAMES[preview.bucket]} (${formatRD(Math.max(0, preview.bucketBefore))}). Esa categoría quedaría en ${formatRD(preview.bucketAfter)}.` });
  } else if (preview.levelAfter > preview.levelBefore && preview.levelAfter >= 75) {
    w.push({ level: 'info', text: `Con este gasto llegarías al ${Math.round(preview.pctAfter)} % de ${SHORT_NAMES[preview.bucket]}.` });
  }
  if (!preview.exceedsTotal && preview.shareOfAvailable >= 50 && preview.daysLeft > 1) {
    w.push({ level: 'warn', text: `Es el ${Math.round(preview.shareOfAvailable)} % de lo que te queda y faltan ${preview.daysLeft} días. Te quedarían ${formatRD(preview.perDayAfter)} por día.` });
  }
  if (closedWeek) w.push({ level: 'info', text: 'Esa semana ya está cerrada; el gasto cambiará su resumen.' });
  return w;
}

// Comprueba que una transferencia no deje en negativo la cuenta de origen.
export function validateTransfer(state, { from, to, amount, excludeAmount = 0 }) {
  const errors = [];
  if (!(Number.isInteger(amount) && amount > 0)) errors.push('El importe debe ser mayor que RD$0.');
  if (from === to) errors.push('El origen y el destino deben ser distintos.');
  const available = (state.balances[from] || 0) + excludeAmount;
  if (amount > available) errors.push(`${ACCOUNT_NAMES[from]} solo tiene ${formatRD(Math.max(0, available))}.`);
  return errors;
}

/* ---------------- Deseos (regla de las 24 h) ---------------- */

export function wishReadyAt(wish) {
  const d = parseLocal(wish.createdAt);
  d.setHours(d.getHours() + WISH_WAIT_HOURS);
  return toLocalISO(d);
}

export function wishIsReady(wish, nowISO) {
  return wish.status === 'pendiente' && wishReadyAt(wish) <= nowISO;
}

export function hoursUntilReady(wish, nowISO) {
  const ms = parseLocal(wishReadyAt(wish)).getTime() - parseLocal(nowISO).getTime();
  return Math.max(0, Math.ceil(ms / 3600000));
}

/* ---------------- Cierre semanal ---------------- */

export const CLOSE_OPTIONS = {
  salidas: ['fondoSalidas', 'keep', 'ahorro'],
  personal: ['keep', 'ahorro'],
  reserva: ['ahorro', 'keep'],
};

export function closeProposal(state, weekKey) {
  const w = state.weeks[weekKey];
  const out = {};
  for (const b of BUCKETS) {
    const left = w ? w.closing[b] : 0;
    out[b] = { amount: Math.max(0, left), dest: CLOSE_OPTIONS[b][0] };
  }
  return out;
}

// Crea las transferencias del cierre (fechadas el domingo 23:59 de esa semana).
export function buildCloseTransfers(weekKey, decisions, makeId) {
  const date = `${weekEnd(weekKey)}T23:59`;
  const list = [];
  for (const b of BUCKETS) {
    const d = decisions[b];
    if (!d || d.dest === 'keep' || !(d.amount > 0)) continue;
    list.push({ id: makeId(), type: 'transfer', date, from: b, to: d.dest, amount: d.amount, note: 'Cierre semanal', closeOf: weekKey, createdAt: Date.now() });
  }
  return list;
}

export function canCloseWeek(weekKey, nowISO) {
  const cur = weekKeyOf(nowISO);
  if (weekKey < cur) return true;
  return weekKey === cur && dayIndex(nowISO) === 6; // domingo
}

/* ---------------- Estadísticas ---------------- */

export function categoryName(data, id) {
  return data.categories.find((c) => c.id === id)?.name || 'Categoría eliminada';
}

export function activeWeeks(state) {
  return Object.values(state.weeks).filter((w) => w.hasActivity).sort((a, b) => (a.weekKey < b.weekKey ? -1 : 1));
}

export function statsSummary(state, data) {
  const weeks = activeWeeks(state);
  const complete = weeks.filter((w) => w.isComplete);
  const base = complete.length ? complete : weeks;
  const avgWeeklySpend = base.length ? Math.round(base.reduce((a, w) => a + w.spent, 0) / base.length) : 0;
  const compliance = complete.length ? (complete.filter((w) => w.withinBudget).length / complete.length) * 100 : null;
  const savingsMetPct = complete.length ? (complete.filter((w) => w.savingsMet).length / complete.length) * 100 : null;
  const byCategory = {};
  let impulsive = 0;
  let spent = 0;
  for (const w of weeks) {
    spent += w.spent;
    impulsive += w.impulsive;
    for (const [c, v] of Object.entries(w.byCategory)) byCategory[c] = (byCategory[c] || 0) + v;
  }
  const topCategories = Object.entries(byCategory)
    .map(([id, amount]) => ({ id, name: categoryName(data, id), amount }))
    .sort((a, b) => b.amount - a.amount);
  const unusedFunds = {
    fondoSalidas: state.balances.fondoSalidas,
    objetivos: state.balances.objetivos,
    reserva: Math.max(0, state.balances.reserva),
    sobrantes: Math.max(0, state.balances.salidas) + Math.max(0, state.balances.personal),
  };
  const discardedWishes = (data.wishes || []).filter((x) => x.status === 'descartado');
  return {
    weeksCount: weeks.length,
    completeCount: complete.length,
    avgWeeklySpend,
    compliance,
    savingsMetPct,
    topCategories,
    totalSpent: spent,
    totalImpulsive: impulsive,
    impulsiveShare: spent ? (impulsive / spent) * 100 : 0,
    unusedFunds,
    avoided: discardedWishes.reduce((a, x) => a + x.amount, 0),
    avoidedCount: discardedWishes.length,
  };
}

export function movementsInPeriod(data, period, key) {
  return sortMovements(data.movements)
    .reverse()
    .filter((m) => {
      if (period === 'dia') return dayKeyOf(m.date) === key;
      if (period === 'semana') return weekKeyOf(m.date) === key;
      return monthKeyOf(m.date) === key;
    });
}

/* ---------------- Informe semanal para ChatGPT ---------------- */

const pct = (v) => `${Math.round(v)} %`;

export function buildWeeklyReport(state, data, weekKey) {
  const w = state.weeks[weekKey];
  if (!w) return 'No hay datos para esa semana.';
  const prev = activeWeeks(state).filter((x) => x.weekKey < weekKey).slice(-4);
  const L = [];
  L.push(`INFORME SEMANAL DE MI MESADA (${weekLabelLong(weekKey)})`);
  L.push('Moneda: pesos dominicanos (RD$).');
  L.push('');
  L.push('RESUMEN');
  L.push(`- Mesada recibida: ${formatRD(w.allowance)}${w.allowanceCount === 0 ? ' (no registré mesada esta semana)' : ''}`);
  if (w.extraIncome) L.push(`- Ingresos extraordinarios: ${formatRD(w.extraIncome)}`);
  L.push(`- Presupuesto para gastar (incluye lo que arrastraba): ${formatRD(w.totalBudget)}`);
  L.push(`- Total gastado: ${formatRD(w.spent)} en ${w.expenseCount} ${w.expenseCount === 1 ? 'gasto' : 'gastos'}`);
  L.push(`- Presupuesto sobrante: ${formatRD(w.leftover)}`);
  L.push(`- Ahorro conseguido esta semana (neto): ${formatRD(w.savingsNet)} — objetivo ${formatRD(w.savingsTarget)}: ${w.savingsMet ? 'CUMPLIDO' : 'NO cumplido'}`);
  L.push(`- ¿Me mantuve dentro del presupuesto?: ${w.withinBudget ? 'Sí' : 'No'}`);
  L.push('');
  L.push('POR PRESUPUESTO (asignado esta semana / disponible / gastado / sobrante)');
  for (const b of BUCKETS) {
    L.push(`- ${ACCOUNT_NAMES[b]}: ${formatRD(w.alloc[b])} / ${formatRD(w.budget[b])} / ${formatRD(w.byBucket[b])} / ${formatRD(w.remaining[b])} (${pct(w.usage[b])} usado)`);
  }
  L.push('');
  L.push('GASTOS POR CATEGORÍA');
  const cats = Object.entries(w.byCategory).sort((a, b) => b[1] - a[1]);
  if (!cats.length) L.push('- Sin gastos registrados.');
  for (const [id, v] of cats) L.push(`- ${categoryName(data, id)}: ${formatRD(v)} (${pct((v / w.spent) * 100)} del total)`);
  if (w.topCategory) L.push(`Categoría con más gasto: ${categoryName(data, w.topCategory.categoryId)} (${formatRD(w.topCategory.amount)}).`);
  L.push('');
  L.push('PLANIFICADO VS. IMPULSIVO');
  L.push(`- Planificado: ${formatRD(w.planned)}`);
  L.push(`- Impulsivo: ${formatRD(w.impulsive)} en ${w.impulsiveCount} ${w.impulsiveCount === 1 ? 'compra' : 'compras'}${w.spent ? ` (${pct((w.impulsive / w.spent) * 100)} del gasto)` : ''}`);
  const imp = data.movements.filter((m) => m.type === 'expense' && m.kind === 'impulsivo' && weekKeyOf(m.date) === weekKey);
  for (const m of sortMovements(imp)) L.push(`  · ${dayLabel(dayKeyOf(m.date))}: ${formatRD(m.amount)} — ${categoryName(data, m.categoryId)}${m.description ? ` (${m.description})` : ''}`);
  L.push('');
  L.push('GASTO POR DÍA');
  for (let i = 0; i < 7; i++) {
    const d = addDays(weekKey, i);
    L.push(`- ${dayLabel(d)}: ${formatRD(w.byDay[d] || 0)}`);
  }
  L.push('');
  L.push('MOVIMIENTOS ENTRE MIS FONDOS (no son gastos ni ingresos)');
  const tr = data.movements.filter((m) => m.type === 'transfer' && weekKeyOf(m.date) === weekKey);
  if (!tr.length) L.push('- Ninguno.');
  for (const m of sortMovements(tr)) L.push(`- ${formatRD(m.amount)}: ${ACCOUNT_NAMES[m.from]} → ${ACCOUNT_NAMES[m.to]}${m.note ? ` (${m.note})` : ''}`);
  L.push('');
  L.push('SALDOS AL FINAL DE LA SEMANA');
  L.push(`- Ahorro líquido: ${formatRD(w.closing.ahorro)} (meta ${formatRD(data.settings.savingsGoal)}: ${pct((w.closing.ahorro / data.settings.savingsGoal) * 100)})`);
  L.push(`- Fondo para salidas: ${formatRD(w.closing.fondoSalidas)}`);
  L.push(`- Objetivos personales: ${formatRD(w.closing.objetivos)}`);
  L.push(`- Inversiones en bolsa (aparte, no disponibles para gastar): ${formatRD(w.closing.inversion)}`);
  L.push(`- Dinero que pasa a la próxima semana en presupuestos: ${formatRD(BUCKETS.reduce((a, b) => a + w.closing[b], 0))}`);
  L.push('');
  L.push('COMPARACIÓN CON SEMANAS ANTERIORES');
  if (!prev.length) {
    L.push('- No hay semanas anteriores registradas para comparar.');
  } else {
    const avg = Math.round(prev.reduce((a, x) => a + x.spent, 0) / prev.length);
    for (const p of prev) L.push(`- Semana ${weekLabel(p.weekKey)}: gastado ${formatRD(p.spent)}, impulsivo ${formatRD(p.impulsive)}, ahorro neto ${formatRD(p.savingsNet)}`);
    const diff = w.spent - avg;
    L.push(`- Promedio de esas ${prev.length} semanas: ${formatRD(avg)}. Esta semana: ${diff === 0 ? 'igual al promedio' : `${formatRD(Math.abs(diff))} ${diff > 0 ? 'más' : 'menos'} que el promedio`}.`);
  }
  L.push('');
  L.push('PUNTOS QUE MERECEN ATENCIÓN (según los datos registrados)');
  const notes = attentionPoints(w, data, prev);
  if (!notes.length) L.push('- Nada fuera de lo normal según los datos registrados.');
  for (const n of notes) L.push(`- ${n}`);
  L.push('');
  L.push('¿Puedes analizar mi semana conmigo?');
  return L.join('\n');
}

export function attentionPoints(w, data, prev = []) {
  const out = [];
  for (const b of BUCKETS) {
    if (w.byBucket[b] > w.budget[b] && w.byBucket[b] > 0) out.push(`Me pasé en ${ACCOUNT_NAMES[b]} por ${formatRD(w.byBucket[b] - w.budget[b])}.`);
    else if (w.usage[b] >= 90 && w.byBucket[b] > 0) out.push(`Usé el ${pct(w.usage[b])} de ${ACCOUNT_NAMES[b]}.`);
  }
  if (w.spent > 0 && w.impulsive / w.spent >= 0.3) out.push(`Las compras impulsivas fueron el ${pct((w.impulsive / w.spent) * 100)} de mi gasto.`);
  if (!w.savingsMet) out.push(`No llegué al objetivo de ahorro: me faltaron ${formatRD(w.savingsTarget - w.savingsNet)}.`);
  if (w.savingsOut > 0) out.push(`Retiré ${formatRD(w.savingsOut)} de mis ahorros.`);
  if (w.spent > 0) {
    const days = Object.entries(w.byDay).sort((a, b) => b[1] - a[1]);
    const [d, v] = days[0];
    if (v / w.spent >= 0.5 && days.length > 1) out.push(`El ${dayLabel(d)} concentró el ${pct((v / w.spent) * 100)} del gasto (${formatRD(v)}).`);
  }
  if (prev.length) {
    const avg = prev.reduce((a, x) => a + x.spent, 0) / prev.length;
    if (avg > 0 && w.spent > avg * 1.25) out.push(`Gasté un ${pct(((w.spent - avg) / avg) * 100)} más que mi promedio reciente.`);
  }
  const discarded = (data.wishes || []).filter((x) => x.status === 'descartado' && x.decidedAt && weekKeyOf(x.decidedAt) === w.weekKey);
  if (discarded.length) out.push(`Tras esperar 24 h decidí no comprar ${discarded.length} ${discarded.length === 1 ? 'cosa' : 'cosas'} (${formatRD(discarded.reduce((a, x) => a + x.amount, 0))}).`);
  if (w.allowanceCount === 0) out.push('No hay mesada registrada en esta semana.');
  return out;
}

/* ---------------- Integridad de datos importados ---------------- */

export function validateImport(obj) {
  if (!obj || typeof obj !== 'object') return 'El archivo no contiene datos válidos.';
  if (!Array.isArray(obj.movements) || !Array.isArray(obj.categories) || !obj.settings) return 'El archivo no parece una copia de seguridad de esta app.';
  if (obj.version > SCHEMA_VERSION) return 'La copia es de una versión más nueva de la app.';
  const ids = new Set();
  for (const m of obj.movements) {
    if (!m.id || ids.has(m.id)) return 'La copia tiene movimientos repetidos o sin identificador.';
    ids.add(m.id);
    const errs = validateMovement(m, obj);
    if (errs.length) return `Movimiento no válido (${m.date || 'sin fecha'}): ${errs[0]}`;
  }
  return null;
}

export function migrate(obj) {
  const base = defaultData();
  const out = { ...base, ...obj };
  out.settings = { ...base.settings, ...(obj.settings || {}) };
  out.settings.plan = { ...base.settings.plan, ...(obj.settings?.plan || {}) };
  out.settings.extraSplit = { ...base.settings.extraSplit, ...(obj.settings?.extraSplit || {}) };
  out.wishes ||= [];
  out.closes ||= {};
  out.log ||= [];
  out.version = SCHEMA_VERSION;
  return out;
}

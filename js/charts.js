// Gráficos SVG sencillos, sin librerías (funcionan sin conexión).
import { formatRD } from './core.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function compact(cents) {
  const v = cents / 100;
  if (Math.abs(v) >= 1000) return 'RD$' + (v / 1000).toFixed(v % 1000 === 0 ? 0 : 1) + 'k';
  return 'RD$' + Math.round(v);
}

// Barras verticales con etiqueta de valor encima; `limit` dibuja una línea de referencia (p. ej. presupuesto).
export function barChart({ items, limit = null, limitLabel = '', height = 180, color = 'var(--primary)', overColor = 'var(--danger)', title }) {
  if (!items.length) return '';
  const W = 320;
  const H = height;
  const top = 22;
  const bottom = 24;
  const max = Math.max(1, ...items.map((i) => i.value), limit || 0);
  const slot = W / items.length;
  const bw = Math.min(34, slot * 0.6);
  const y = (v) => top + (H - top - bottom) * (1 - v / max);
  const bars = items
    .map((it, i) => {
      const x = i * slot + (slot - bw) / 2;
      const yy = y(it.value);
      const fill = limit != null && it.value > limit ? overColor : it.color || color;
      return `<g><title>${esc(it.label)}: ${esc(formatRD(it.value))}</title>
        <rect x="${x}" y="${yy}" width="${bw}" height="${Math.max(0, H - bottom - yy)}" rx="4" fill="${fill}"/>
        <text x="${x + bw / 2}" y="${yy - 6}" text-anchor="middle" class="ch-val">${esc(it.value ? compact(it.value) : '')}</text>
        <text x="${x + bw / 2}" y="${H - 6}" text-anchor="middle" class="ch-lab">${esc(it.short || it.label)}</text></g>`;
    })
    .join('');
  const lim =
    limit != null
      ? `<line x1="0" x2="${W}" y1="${y(limit)}" y2="${y(limit)}" class="ch-limit"/><text x="${W}" y="${y(limit) - 4}" text-anchor="end" class="ch-lab">${esc(limitLabel)}</text>`
      : '';
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${esc(title)}">${lim}${bars}</svg>`;
}

// Línea con área (evolución del ahorro). `goal` dibuja la meta.
export function lineChart({ points, goal = null, goalLabel = '', height = 170, title }) {
  if (points.length < 2) return '';
  const W = 320;
  const H = height;
  const pad = { t: 18, b: 22, l: 4, r: 4 };
  const max = Math.max(1, ...points.map((p) => p.value), goal || 0) * 1.05;
  const x = (i) => pad.l + ((W - pad.l - pad.r) * i) / (points.length - 1);
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `${d} L${x(points.length - 1)},${H - pad.b} L${x(0)},${H - pad.b} Z`;
  const g =
    goal != null
      ? `<line x1="0" x2="${W}" y1="${y(goal)}" y2="${y(goal)}" class="ch-limit"/><text x="${W - 2}" y="${y(goal) - 4}" text-anchor="end" class="ch-lab">${esc(goalLabel)}</text>`
      : '';
  const lastP = points[points.length - 1];
  const step = Math.ceil(points.length / 6);
  const labels = points
    .map((p, i) => (i % step === 0 || i === points.length - 1 ? `<text x="${x(i)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}" class="ch-lab">${esc(p.short)}</text>` : ''))
    .join('');
  const dots = points.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.value)}" r="3" class="ch-dot"><title>${esc(p.label)}: ${esc(formatRD(p.value))}</title></circle>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${esc(title)}">${g}
    <path d="${area}" class="ch-area"/><path d="${d}" class="ch-line"/>${dots}
    <text x="${x(points.length - 1)}" y="${y(lastP.value) - 8}" text-anchor="end" class="ch-val">${esc(compact(lastP.value))}</text>${labels}</svg>`;
}

// Barras horizontales con nombre e importe visibles (ranking de categorías).
export function hBars(items, { total } = {}) {
  if (!items.length) return '';
  const max = Math.max(1, ...items.map((i) => i.value));
  return `<ul class="hbars">${items
    .map(
      (it) => `<li><div class="hb-row"><span>${esc(it.label)}</span><strong class="num">${esc(formatRD(it.value))}${total ? ` <small class="muted">${Math.round((it.value / total) * 100)} %</small>` : ''}</strong></div>
      <div class="bar"><span style="width:${((it.value / max) * 100).toFixed(1)}%;${it.color ? `background:${it.color}` : ''}"></span></div></li>`,
    )
    .join('')}</ul>`;
}

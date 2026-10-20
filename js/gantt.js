import { esc, todayStr, shortThaiDate } from './util.js';

const DAY = 86400000;
const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const MIN_MONTHS = 4;

const dn = (s) => {
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY;
};
const monthIdx = (day) => {
  const d = new Date(day * DAY);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
};
const monthStart = (idx) => Date.UTC(Math.floor(idx / 12), idx % 12, 1) / DAY;
const pct = (v) => +(v * 100).toFixed(3);

export function ganttHtml(list, { selectedId, collapsed, animate }) {
  if (!list.length) return '';
  const today = dn(todayStr());

  // วันเริ่ม/สิ้นสุดของแต่ละแถว (null = ไม่มีแถบ)
  const rows = list.map((p) => {
    if (!p.start_date) return { p, bar: null };
    const s = dn(p.start_date);
    const open = !p.end_date;
    const e = open ? Math.max(s, today) : Math.max(s, dn(p.end_date));
    return { p, bar: { s, e, open } };
  });
  const bars = rows.filter((r) => r.bar).map((r) => r.bar);

  let first;
  let last;
  if (bars.length) {
    first = monthIdx(Math.min(...bars.map((b) => b.s)));
    last = monthIdx(Math.max(...bars.map((b) => b.e))) + 1; // เผื่อหลังวันสิ้นสุดอีก 1 เดือน
  } else {
    first = monthIdx(today);
    last = first;
  }
  last = Math.max(last, first + MIN_MONTHS - 1);
  const n = last - first + 1;
  const r0 = monthStart(first);
  const total = monthStart(last + 1) - r0;
  const x = (day) => pct((day - r0) / total);

  const bounds = Array.from({ length: n }, (_, i) => monthStart(first + i));
  const lines = bounds.slice(1).map((b) => `<i class="g-ml" style="left:${x(b)}%"></i>`).join('');
  const todayIn = today >= r0 && today < r0 + total;
  const todayLine = todayIn ? `<i class="g-tl" style="left:${x(today + 0.5)}%"></i>` : '';

  const head = bounds.map((b, i) => {
    const idx = first + i;
    const m = idx % 12;
    const showYear = i === 0 || m === 0;
    const label = MONTHS[m] + (showYear ? ' ' + String((Math.floor(idx / 12) + 543) % 100).padStart(2, '0') : '');
    return `<span class="g-m" style="left:${x(b)}%;width:${pct((monthStart(idx + 1) - b) / total)}%">${label}</span>`;
  }).join('');

  const tx = x(today + 0.5);
  const badge = todayIn
    ? `<span class="g-badge${tx > 90 ? ' r' : tx < 8 ? ' l' : ''}" style="left:${tx}%"><i class="pulse"></i>วันนี้</span>` : '';

  const body = rows.map(({ p, bar }, i) => {
    let barHtml = '';
    if (bar) {
      const len = bar.e + 1 - bar.s;
      const done = Math.max(0, Math.min(len, today + 1 - bar.s)) / len * 100;
      const range = `${shortThaiDate(p.start_date)} – ${p.end_date ? shortThaiDate(p.end_date) : 'ปัจจุบัน'}`;
      barHtml = `<button type="button" class="g-bar s-${esc(p.status)}${bar.open ? ' open' : ''}" data-open="${esc(p.id)}"
        style="left:${x(bar.s)}%;width:max(6px,${pct(len / total)}%);--d:${done.toFixed(1)}%;--k:${Math.min(i, 12)}"
        title="${esc(p.name)} · ${esc(range)}" aria-label="${esc(p.name)} ${esc(range)}"><i class="g-done"></i></button>`;
    }
    return `<div class="g-row${p.id === selectedId ? ' sel' : ''}" data-id="${esc(p.id)}">
      <div class="g-label"><button type="button" class="g-name" data-open="${esc(p.id)}" title="${esc(p.name)}">${esc(p.name)}</button></div>
      <div class="g-track">${lines}${todayLine}${barHtml}</div></div>`;
  }).join('');

  return `<section class="gantt${animate ? ' anim' : ''}" aria-label="ไทม์ไลน์โปรเจกต์">
    <div class="g-top"><h2>ไทม์ไลน์</h2>
      <button type="button" class="ghost sm" data-g-toggle aria-expanded="${!collapsed}">${collapsed ? 'ขยาย' : 'พับ'}</button></div>
    ${collapsed ? '' : `<div class="g-scroll" tabindex="0" aria-label="ไทม์ไลน์ เลื่อนแนวนอนได้"><div class="g-inner" style="--n:${n}">
      <div class="g-row g-headrow"><div class="g-label"></div><div class="g-track g-ht">${head}</div></div>
      <div class="g-row g-badgerow"><div class="g-label"></div><div class="g-track">${badge}</div></div>
      ${body}</div></div>`}
  </section>`;
}
